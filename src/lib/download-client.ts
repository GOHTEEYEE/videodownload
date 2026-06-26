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

export function triggerBrowserDownload(href: string, filename: string): void {
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
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
}): boolean {
  if (!options.streamUrl) return false;
  if (options.needsTranslation || options.needsWatermarkRemoval) return false;
  if (options.mediaType === 'video') return true;
  const ext = (options.formatExt || '').toLowerCase();
  return ext === 'mp3' || ext === 'm4a' || options.streamUrl.includes('.mp3');
}
