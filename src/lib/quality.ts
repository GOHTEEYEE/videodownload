import {
  type MediaFormat,
  groupAudioFormats,
  groupVideoFormats,
  formatResolutionLabel,
  pickBestVideo,
} from './formats';

export const QUALITY_BEST = 'best' as const;

export const VIDEO_QUALITY_OPTIONS = [
  { value: QUALITY_BEST, label: 'Highest Available (Recommended)' },
  { value: 2160, label: '4K' },
  { value: 1440, label: '2K' },
  { value: 1080, label: '1080P' },
  { value: 720, label: '720P' },
  { value: 480, label: '480P' },
  { value: 360, label: '360P' },
] as const;

export const AUDIO_QUALITY_OPTIONS = [
  { value: QUALITY_BEST, label: 'Highest Available (Recommended)' },
  { value: 320, label: '320kbps' },
  { value: 256, label: '256kbps' },
  { value: 192, label: '192kbps' },
  { value: 128, label: '128kbps' },
] as const;

export type VideoQualityChoice = typeof QUALITY_BEST | 2160 | 1440 | 1080 | 720 | 480 | 360;
export type AudioQualityChoice = typeof QUALITY_BEST | 320 | 256 | 192 | 128;

/** @deprecated use VideoQualityChoice */
export type VideoQualityPreset = 480 | 720 | 1080 | 1440 | 2160;
/** @deprecated use AudioQualityChoice */
export type AudioBitratePreset = 128 | 192 | 256 | 320;

export const VIDEO_QUALITY_PRESETS = VIDEO_QUALITY_OPTIONS.filter(
  (o) => o.value !== QUALITY_BEST
) as unknown as readonly { height: number; label: string }[];

export const AUDIO_BITRATE_PRESETS = AUDIO_QUALITY_OPTIONS.filter(
  (o) => o.value !== QUALITY_BEST
) as unknown as readonly { abr: number; label: string }[];

export type QualityResolution = {
  requested: number;
  actual: number;
  requestedLabel: string;
  actualLabel: string;
  format: MediaFormat | null;
  notice: string | null;
};

export const FALLBACK_NOTICE = 'Downloaded in the highest available quality.';

export const getAvailableHeights = (formats: MediaFormat[]): number[] =>
  groupVideoFormats(formats).map((o) => o.height);

export const getAvailableBitrates = (formats: MediaFormat[]): number[] =>
  groupAudioFormats(formats)
    .map((o) => o.abr)
    .filter((abr) => abr > 0);

const labelForHeight = (height: number): string => {
  const preset = VIDEO_QUALITY_OPTIONS.find((p) => p.value === height);
  return preset?.label ?? formatResolutionLabel(height);
};

const labelForBitrate = (abr: number): string => {
  const preset = AUDIO_QUALITY_OPTIONS.find((p) => p.value === abr);
  return preset?.label ?? `${abr}kbps`;
};

export const pickClosestAtOrBelow = (requested: number, available: number[]): number => {
  if (available.length === 0) return requested;
  const sorted = [...available].sort((a, b) => b - a);
  const atOrBelow = sorted.filter((v) => v <= requested);
  return atOrBelow.length > 0 ? atOrBelow[0] : sorted[0];
};

export const pickFormatForHeight = (
  formats: MediaFormat[],
  height: number,
  extractorKey?: string
): MediaFormat | null => {
  const grouped = groupVideoFormats(formats);
  if (grouped.length === 0) {
    return pickBestVideo(formats, extractorKey);
  }

  const exact = grouped.find((g) => g.height === height);
  if (exact) return exact.format;

  const atOrBelow = grouped.filter((g) => g.height <= height);
  if (atOrBelow.length > 0) return atOrBelow[0].format;

  return grouped[0].format;
};

export const pickFormatForBitrate = (
  formats: MediaFormat[],
  abr: number
): MediaFormat | null => {
  const grouped = groupAudioFormats(formats);
  if (grouped.length === 0 || grouped[0].abr === 0) {
    return { format_id: 'bestaudio', ext: 'mp3', acodec: 'mp3' };
  }

  const exact = grouped.find((g) => g.abr === abr);
  if (exact) return exact.format;

  const atOrBelow = grouped.filter((g) => g.abr <= abr);
  if (atOrBelow.length > 0) return atOrBelow[0].format;

  return grouped[0].format;
};

const resolveRequestedHeight = (
  choice: VideoQualityChoice | number,
  formats: MediaFormat[]
): number => {
  if (choice === QUALITY_BEST) {
    const available = getAvailableHeights(formats);
    return available.length > 0 ? Math.max(...available) : 1080;
  }
  return choice;
};

const resolveRequestedAbr = (
  choice: AudioQualityChoice | number,
  formats: MediaFormat[]
): number => {
  if (choice === QUALITY_BEST) {
    const available = getAvailableBitrates(formats);
    return available.length > 0 ? Math.max(...available) : 192;
  }
  return choice;
};

export const resolveVideoQuality = (
  choice: VideoQualityChoice | number,
  formats: MediaFormat[],
  extractorKey?: string
): QualityResolution => {
  const available = getAvailableHeights(formats);
  const requestedHeight = resolveRequestedHeight(choice as VideoQualityChoice, formats);
  const actualHeight = pickClosestAtOrBelow(requestedHeight, available);
  const format = pickFormatForHeight(formats, actualHeight, extractorKey);

  let notice: string | null = null;
  if (
    choice !== QUALITY_BEST &&
    available.length > 0 &&
    actualHeight !== requestedHeight
  ) {
    notice = FALLBACK_NOTICE;
  }

  return {
    requested: requestedHeight,
    actual: actualHeight,
    requestedLabel: labelForHeight(requestedHeight),
    actualLabel: labelForHeight(actualHeight),
    format,
    notice,
  };
};

export const resolveAudioBitrate = (
  choice: AudioQualityChoice | number,
  formats: MediaFormat[]
): QualityResolution => {
  const available = getAvailableBitrates(formats);
  const requestedAbr = resolveRequestedAbr(choice as AudioQualityChoice, formats);
  const actualAbr = pickClosestAtOrBelow(requestedAbr, available);
  const format = pickFormatForBitrate(formats, actualAbr);

  let notice: string | null = null;
  if (
    choice !== QUALITY_BEST &&
    available.length > 0 &&
    actualAbr !== requestedAbr
  ) {
    notice = FALLBACK_NOTICE;
  }

  return {
    requested: requestedAbr,
    actual: actualAbr,
    requestedLabel: labelForBitrate(requestedAbr),
    actualLabel: available.length > 0 ? labelForBitrate(actualAbr) : 'best available',
    format,
    notice,
  };
};

export const supportsSubtitles = (extractorKey?: string, webpageUrl?: string): boolean => {
  const key = extractorKey?.toLowerCase() || '';
  const url = webpageUrl?.toLowerCase() || '';
  return (
    key.includes('youtube') ||
    key.includes('bilibili') ||
    key.includes('douyin') ||
    key.includes('tiktok') ||
    url.includes('youtube.com') ||
    url.includes('youtu.be') ||
    url.includes('bilibili.com') ||
    url.includes('douyin.com') ||
    url.includes('tiktok.com')
  );
};
