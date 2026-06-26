export interface MediaFormat {
  format_id: string;
  ext?: string;
  height?: number;
  width?: number;
  abr?: number;
  tbr?: number;
  vcodec?: string;
  acodec?: string;
  filesize?: number;
  filesize_approx?: number;
  url?: string;
  format_note?: string;
  protocol?: string;
  resolution?: string;
}

export type VideoOption = {
  height: number;
  label: string;
  format: MediaFormat;
};

export type AudioOption = {
  abr: number;
  label: string;
  format: MediaFormat;
};

const isHttpFormat = (f: MediaFormat) =>
  !f.protocol || f.protocol === 'https' || f.protocol === 'http';

export const hasEmbeddedAudio = (format: MediaFormat | null | undefined): boolean =>
  Boolean(format?.acodec && format.acodec !== 'none');

export const isVideoOnlyFormat = (format: MediaFormat | null | undefined): boolean =>
  Boolean(
    format?.vcodec &&
      format.vcodec !== 'none' &&
      (!format.acodec || format.acodec === 'none')
  );

export const formatNeedsAudioMerge = (format: MediaFormat | null | undefined): boolean =>
  isVideoOnlyFormat(format);

export const parseHeight = (format: MediaFormat): number | null => {
  if (format.height) return format.height;
  const match = format.resolution?.match(/(\d+)x(\d+)/i);
  if (match) return parseInt(match[2], 10);
  return null;
};

export const formatResolutionLabel = (height: number): string => {
  if (height >= 2160) return '4K';
  if (height >= 1440) return '2K';
  return `${height}P`;
};

const formatScore = (f: MediaFormat): number => {
  let score = 0;
  if (hasEmbeddedAudio(f)) score += 10_000;
  if (isVideoOnlyFormat(f)) score -= 5_000;
  if (!f.format_note?.toLowerCase().includes('watermark')) score += 50;
  if (f.format_note?.toLowerCase().includes('play api')) score += 40;
  score += (f.filesize || f.filesize_approx || 0) / 1_000_000;
  return score;
};

export const groupVideoFormats = (formats: MediaFormat[]): VideoOption[] => {
  const byHeight = new Map<number, MediaFormat>();

  for (const format of formats) {
    if (!isHttpFormat(format)) continue;
    const height = parseHeight(format);
    if (!height) continue;
    if (format.vcodec === 'none') continue;

    const existing = byHeight.get(height);
    if (!existing) {
      byHeight.set(height, format);
      continue;
    }

    const candidateMuxed = hasEmbeddedAudio(format);
    const existingMuxed = hasEmbeddedAudio(existing);
    if (candidateMuxed && !existingMuxed) {
      byHeight.set(height, format);
      continue;
    }
    if (!candidateMuxed && existingMuxed) {
      continue;
    }

    if (formatScore(format) > formatScore(existing)) {
      byHeight.set(height, format);
    }
  }

  return Array.from(byHeight.entries())
    .sort(([a], [b]) => b - a)
    .map(([height, format]) => ({
      height,
      label: formatResolutionLabel(height),
      format,
    }));
};

export const groupAudioFormats = (formats: MediaFormat[]): AudioOption[] => {
  const byAbr = new Map<number, MediaFormat>();

  for (const format of formats) {
    if (!isHttpFormat(format)) continue;
    if (format.vcodec && format.vcodec !== 'none') continue;
    if (!format.acodec || format.acodec === 'none') continue;

    const abr = Math.round(format.abr || format.tbr || 0);
    if (!abr) continue;

    const existing = byAbr.get(abr);
    if (!existing || (format.filesize || 0) > (existing.filesize || 0)) {
      byAbr.set(abr, format);
    }
  }

  if (byAbr.size === 0) {
    return [
      {
        abr: 0,
        label: 'Best available',
        format: { format_id: 'bestaudio', ext: 'mp3', acodec: 'mp3' },
      },
    ];
  }

  return Array.from(byAbr.entries())
    .sort(([a], [b]) => b - a)
    .map(([abr, format]) => ({
      abr,
      label: `${abr}kbps`,
      format,
    }));
};

export const pickBestMuxedFormat = (
  formats: MediaFormat[],
  maxHeight?: number
): MediaFormat | null => {
  const muxed = formats.filter(
    (f) =>
      hasEmbeddedAudio(f) &&
      f.vcodec &&
      f.vcodec !== 'none' &&
      isHttpFormat(f) &&
      f.url
  );

  if (muxed.length === 0) return null;

  const sorted = [...muxed].sort(
    (a, b) => (parseHeight(b) || 0) - (parseHeight(a) || 0)
  );

  if (maxHeight && maxHeight > 0) {
    const atOrBelow = sorted.filter((f) => (parseHeight(f) || 0) <= maxHeight);
    if (atOrBelow.length > 0) return atOrBelow[0];
    return sorted[sorted.length - 1] ?? null;
  }

  return sorted[0] ?? null;
};

export const pickBestVideo = (
  formats: MediaFormat[],
  extractorKey?: string
): MediaFormat | null => {
  if (extractorKey?.toLowerCase() === 'douyin') {
    return (
      formats.find((f) => f.format_id === 'best') ||
      formats.find((f) => f.format_note?.includes('play API')) ||
      formats.find((f) => !f.url?.includes('playwm')) ||
      groupVideoFormats(formats)[0]?.format ||
      formats[0] ||
      null
    );
  }

  return groupVideoFormats(formats)[0]?.format || formats[0] || null;
};

export const pickBestAudio = (formats: MediaFormat[]): MediaFormat | null =>
  groupAudioFormats(formats)[0]?.format || null;

export const getPlatformName = (extractorKey?: string, webpageUrl?: string): string => {
  const key = extractorKey?.toLowerCase() || '';
  const url = webpageUrl?.toLowerCase() || '';

  if (key === 'douyin' || url.includes('douyin.com')) return 'Douyin';
  if (key === 'tiktok' || url.includes('tiktok.com')) return 'TikTok';
  if (key === 'youtube' || url.includes('youtube.com') || url.includes('youtu.be')) return 'YouTube';
  if (key === 'bilibili' || url.includes('bilibili.com')) return 'Bilibili';
  if (key === 'instagram' || url.includes('instagram.com')) return 'Instagram';
  if (key === 'facebook' || url.includes('facebook.com')) return 'Facebook';
  if (key === 'twitter' || url.includes('twitter.com') || url.includes('x.com')) return 'X';
  if (extractorKey) return extractorKey.charAt(0).toUpperCase() + extractorKey.slice(1);
  return 'Video';
};

export const formatFileSize = (bytes?: number): string => {
  if (!bytes) return '—';
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
};

export const formatDuration = (seconds?: number): string => {
  if (!seconds) return '—';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export const formatViewCount = (views?: number): string | null => {
  if (!views) return null;
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1)}M views`;
  if (views >= 1_000) return `${(views / 1_000).toFixed(1)}K views`;
  return `${views.toLocaleString()} views`;
};
