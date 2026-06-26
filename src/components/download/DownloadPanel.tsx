'use client';

import AnalysisFlow, { type VideoInfo } from '@/components/download/AnalysisFlow';
import { AnimatePresence, motion } from 'framer-motion';
import { Link2, Loader2, ChevronDown } from 'lucide-react';
import {
  VIDEO_QUALITY_OPTIONS,
  AUDIO_QUALITY_OPTIONS,
  QUALITY_BEST,
  type VideoQualityChoice,
  type AudioQualityChoice,
} from '@/lib/quality';
import type { ReadyDownload } from '@/lib/download-client';

export type MediaType = 'video' | 'audio';
export type SubtitleLanguage = 'original' | 'en' | 'zh' | 'ms';

interface DownloadPanelProps {
  url: string;
  setUrl: (v: string) => void;
  mediaType: MediaType;
  setMediaType: (t: MediaType) => void;
  videoQuality: VideoQualityChoice;
  setVideoQuality: (v: VideoQualityChoice) => void;
  audioQuality: AudioQualityChoice;
  setAudioQuality: (v: AudioQualityChoice) => void;
  subtitleLanguage: SubtitleLanguage;
  setSubtitleLanguage: (l: SubtitleLanguage) => void;
  showLanguage: boolean;
  videoTitle?: string | null;
  videoInfo?: VideoInfo | null;
  analyzing: boolean;
  downloading: boolean;
  qualityNotice: string | null;
  error: string | null;
  onDownload: () => void;
  downloadFlowActive?: boolean;
  readyDownload?: ReadyDownload | null;
  cookiesText?: string;
  setCookiesText?: (v: string) => void;
  variant?: 'default' | 'hero';
}

const ease = [0.25, 0.1, 0.25, 1] as const;

export default function DownloadPanel({
  url,
  setUrl,
  mediaType,
  setMediaType,
  videoQuality,
  setVideoQuality,
  audioQuality,
  setAudioQuality,
  subtitleLanguage,
  setSubtitleLanguage,
  showLanguage,
  videoTitle,
  videoInfo,
  analyzing,
  downloading,
  qualityNotice,
  error,
  onDownload,
  downloadFlowActive = false,
  readyDownload = null,
  cookiesText = '',
  setCookiesText,
  variant = 'default',
}: DownloadPanelProps) {
  const busy = analyzing || downloading;
  const isHero = variant === 'hero';
  const showCookiesField =
    Boolean(setCookiesText) &&
    (Boolean(error) || /youtube|douyin|tiktok|cookie|block/i.test(url));

  const cookiesField = showCookiesField ? (
    <details className="panel-cookies-advanced">
      <summary>Advanced: browser cookies (optional)</summary>
      <p className="panel-cookies-hint">
        Only needed when a platform blocks the server. Export cookies while logged in on that site.
      </p>
      <textarea
        className="panel-cookies-input"
        value={cookiesText}
        onChange={(e) => setCookiesText?.(e.target.value)}
        placeholder="Paste Netscape cookies.txt content or Cookie: header value"
        rows={3}
        spellCheck={false}
      />
    </details>
  ) : null;
  const qualityOptions =
    mediaType === 'video'
      ? isHero
        ? VIDEO_QUALITY_OPTIONS.filter((o) => o.value !== 360)
        : VIDEO_QUALITY_OPTIONS
      : isHero
        ? AUDIO_QUALITY_OPTIONS.filter((o) => o.value !== QUALITY_BEST)
        : AUDIO_QUALITY_OPTIONS;
  const qualityValue =
    mediaType === 'video'
      ? videoQuality
      : isHero && audioQuality === QUALITY_BEST
        ? 320
        : audioQuality;

  const handleQualityChange = (raw: string) => {
    if (mediaType === 'video') {
      setVideoQuality(raw === QUALITY_BEST ? QUALITY_BEST : (Number(raw) as VideoQualityChoice));
    } else {
      setAudioQuality(raw === QUALITY_BEST ? QUALITY_BEST : (Number(raw) as AudioQualityChoice));
    }
  };

  if (isHero) {
    if (downloadFlowActive) {
      return (
        <AnalysisFlow
          url={url}
          setUrl={setUrl}
          videoInfo={videoInfo ?? null}
          mediaType={mediaType}
          videoQuality={videoQuality}
          audioQuality={audioQuality}
          analyzing={analyzing}
          downloading={downloading}
          qualityNotice={qualityNotice}
          error={error}
          readyDownload={readyDownload}
          cookiesText={cookiesText}
          setCookiesText={setCookiesText}
        />
      );
    }

    return (
      <div className="download-panel-hero">
        <div className="panel-hero-url">
          <Link2 size={18} className="panel-input-icon" strokeWidth={1.5} />
          <input
            id="download-url"
            type="text"
            className="panel-input"
            placeholder="Paste any video URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            spellCheck={false}
          />
        </div>

        {videoTitle && (
          <motion.p
            className="panel-video-title panel-video-title--hero"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.25 }}
          >
            {videoTitle}
          </motion.p>
        )}

        <div className="panel-hero-controls">
          <div className="panel-format-pill" role="group" aria-label="Download format">
            {(['video', 'audio'] as const).map((type) => (
              <button
                key={type}
                type="button"
                className={`panel-format-btn ${mediaType === type ? 'active' : ''}`}
                onClick={() => setMediaType(type)}
                aria-pressed={mediaType === type}
              >
                {mediaType === type && (
                  <motion.span
                    className="panel-format-indicator"
                    layoutId="format-pill-indicator"
                    transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                  />
                )}
                <span className="panel-format-label">{type === 'video' ? 'MP4' : 'MP3'}</span>
              </button>
            ))}
          </div>

          <div className="panel-hero-select">
            <select
              id="quality-select"
              key={mediaType}
              className="panel-select panel-select--hero"
              value={String(qualityValue)}
              onChange={(e) => handleQualityChange(e.target.value)}
              aria-label="Quality"
            >
              {qualityOptions.map((opt) => (
                <option key={String(opt.value)} value={String(opt.value)}>
                  {opt.label}
                </option>
              ))}
            </select>
            <ChevronDown size={15} className="panel-select-chevron" aria-hidden />
          </div>

          <AnimatePresence mode="popLayout">
            {showLanguage && mediaType === 'video' ? (
              <motion.div
                className="panel-hero-select"
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 'auto' }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.2, ease }}
              >
                <select
                  id="language-select"
                  className="panel-select panel-select--hero"
                  value={subtitleLanguage}
                  onChange={(e) => setSubtitleLanguage(e.target.value as SubtitleLanguage)}
                  aria-label="Language"
                >
                  <option value="original">Original</option>
                  <option value="en">English</option>
                  <option value="zh">Chinese</option>
                  <option value="ms">Malay</option>
                </select>
                <ChevronDown size={15} className="panel-select-chevron" aria-hidden />
              </motion.div>
            ) : null}
          </AnimatePresence>

          <button
            type="button"
            className="panel-hero-download"
            onClick={onDownload}
            disabled={busy || !url.trim()}
          >
            {downloading ? (
              <>
                <Loader2 size={17} className="spin" />
                Downloading…
              </>
            ) : (
              'Download'
            )}
          </button>
        </div>

        {(qualityNotice || error) && (
          <div className="panel-hero-messages">
            {qualityNotice && <p className="panel-notice">{qualityNotice}</p>}
            {error && <p className="panel-error" role="alert">{error}</p>}
          </div>
        )}
        {cookiesField}
      </div>
    );
  }

  return (
    <div className="download-panel-card">
      <div className="panel-field">
        <label className="panel-label" htmlFor="download-url">
          Video URL
        </label>
        <div className="panel-input-wrap">
          <Link2 size={18} className="panel-input-icon" strokeWidth={1.5} />
          <input
            id="download-url"
            type="text"
            className="panel-input"
            placeholder="Paste any video URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            spellCheck={false}
          />
        </div>
      </div>

      {videoTitle && (
        <motion.p
          className="panel-video-title"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25 }}
        >
          {videoTitle}
        </motion.p>
      )}

      <div className="panel-field">
        <span className="panel-label">Download format</span>
        <div className="panel-segment">
          {(['video', 'audio'] as const).map((type) => (
            <button
              key={type}
              type="button"
              className={`panel-segment-btn ${mediaType === type ? 'active' : ''}`}
              onClick={() => setMediaType(type)}
            >
              {mediaType === type && (
                <motion.span
                  className="panel-segment-pill"
                  layoutId="panel-segment-pill"
                  transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                />
              )}
              <span className="panel-segment-text">{type === 'video' ? 'MP4' : 'MP3'}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="panel-field">
        <label className="panel-label" htmlFor="quality-select">
          Quality
        </label>
        <div className="panel-select-wrap">
          <select
            id="quality-select"
            key={mediaType}
            className="panel-select"
            value={String(qualityValue)}
            onChange={(e) => handleQualityChange(e.target.value)}
          >
            {qualityOptions.map((opt) => (
              <option key={String(opt.value)} value={String(opt.value)}>
                {opt.label}
              </option>
            ))}
          </select>
          <ChevronDown size={16} className="panel-select-chevron" aria-hidden />
        </div>
      </div>

      <AnimatePresence>
        {showLanguage && mediaType === 'video' && (
          <motion.div
            className="panel-field"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease }}
          >
            <label className="panel-label" htmlFor="language-select">
              Language
            </label>
            <div className="panel-select-wrap">
              <select
                id="language-select"
                className="panel-select"
                value={subtitleLanguage}
                onChange={(e) => setSubtitleLanguage(e.target.value as SubtitleLanguage)}
              >
                <option value="original">Original</option>
                <option value="en">English</option>
                <option value="zh">Chinese</option>
                <option value="ms">Malay</option>
              </select>
              <ChevronDown size={16} className="panel-select-chevron" aria-hidden />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {qualityNotice && (
        <p className="panel-notice">{qualityNotice}</p>
      )}

      {error && (
        <p className="panel-error" role="alert">{error}</p>
      )}

      {cookiesField}

      <button
        type="button"
        className="panel-download-btn"
        onClick={onDownload}
        disabled={busy || !url.trim()}
      >
        {analyzing ? (
          <>
            <Loader2 size={18} className="spin" />
            Analyzing…
          </>
        ) : downloading ? (
          <>
            <Loader2 size={18} className="spin" />
            Downloading…
          </>
        ) : (
          'Download'
        )}
      </button>
    </div>
  );
}
