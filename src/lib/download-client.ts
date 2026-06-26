export type ReadyDownload = {
  url: string;
  filename: string;
};

export function buildProxyDownloadUrl(
  streamUrl: string,
  filename: string,
  referer?: string
): string {
  const params = new URLSearchParams({
    url: streamUrl,
    filename,
  });
  if (referer) params.set('referer', referer);
  return `/api/proxy?${params.toString()}`;
}

export function toAbsoluteDownloadUrl(href: string): string {
  if (href.startsWith('http://') || href.startsWith('https://')) {
    return href;
  }
  if (typeof window === 'undefined') {
    return href;
  }
  return new URL(href, window.location.origin).href;
}

export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent);
}

export function isInAppBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /MicroMessenger|Line\/|FBAN|FBAV|Instagram|Twitter/i.test(navigator.userAgent);
}

/** Mobile browsers block programmatic downloads after async work — user must tap. */
export function requiresManualDownload(): boolean {
  return isMobileDevice() || isInAppBrowser();
}

export function triggerBrowserDownload(href: string, filename: string): boolean {
  if (requiresManualDownload()) {
    return false;
  }

  const link = document.createElement('a');
  link.href = toAbsoluteDownloadUrl(href);
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  return true;
}

export function refererForUrl(url: string): string | undefined {
  try {
    const host = new URL(url).hostname;
    if (host.includes('douyin.com')) return 'https://www.douyin.com/';
    if (host.includes('tiktok.com')) return 'https://www.tiktok.com/';
    if (host.includes('youtube.com') || host.includes('youtu.be')) return 'https://www.youtube.com/';
    if (host.includes('instagram.com')) return 'https://www.instagram.com/';
    if (host.includes('facebook.com')) return 'https://www.facebook.com/';
    if (host.includes('bilibili.com')) return 'https://www.bilibili.com/';
  } catch {
    // ignore invalid URLs
  }
  return undefined;
}

export function canDownloadDirectly(options: {
  streamUrl?: string | null;
  mediaType: 'video' | 'audio';
  formatExt?: string;
  needsTranslation?: boolean;
  needsWatermarkRemoval?: boolean;
  needsAudioMerge?: boolean;
}): boolean {
  if (!options.streamUrl) return false;
  if (options.needsTranslation || options.needsWatermarkRemoval) return false;
  if (options.needsAudioMerge) return false;
  if (options.mediaType === 'video') return true;
  const ext = (options.formatExt || '').toLowerCase();
  return ext === 'mp3' || ext === 'm4a' || options.streamUrl.includes('.mp3');
}

export function mobileDownloadHint(): string | null {
  if (isInAppBrowser()) {
    return 'Tip: Open this page in Safari or Chrome for downloads to work.';
  }
  if (/iPhone|iPad|iPod/i.test(typeof navigator !== 'undefined' ? navigator.userAgent : '')) {
    return 'Tap the button below. If the video opens, use Share → Save to Files.';
  }
  if (isMobileDevice()) {
    return 'Tap the button below to save the file.';
  }
  return null;
}
