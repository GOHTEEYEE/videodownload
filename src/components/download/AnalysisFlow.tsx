'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { Link2, Loader2 } from 'lucide-react';
import {
  AUDIO_QUALITY_OPTIONS,
  QUALITY_BEST,
  type VideoQualityChoice,
  type AudioQualityChoice,
} from '@/lib/quality';
import { formatResolutionLabel } from '@/lib/formats';
import { mobileDownloadHint, type ReadyDownload } from '@/lib/download-client';
import type { MediaType } from '@/components/download/DownloadPanel';

const ease = [0.25, 0.1, 0.25, 1] as const;

export interface VideoInfo {
  title?: string;
  thumbnail?: string;
  uploader?: string;
  channel?: string;
  creator?: string;
  extractor_key?: string;
  webpage_url?: string;
  formats?: Array<{ height?: number; resolution?: string }>;
}

interface AnalysisFlowProps {
  url: string;
  setUrl: (v: string) => void;
  videoInfo: VideoInfo | null;
  mediaType: MediaType;
  videoQuality: VideoQualityChoice;
  audioQuality: AudioQualityChoice;
  analyzing: boolean;
  downloading: boolean;
  qualityNotice: string | null;
  error: string | null;
  readyDownload?: ReadyDownload | null;
  cookiesText?: string;
  setCookiesText?: (v: string) => void;
}

function qualityLabel(
  mediaType: MediaType,
  videoQuality: VideoQualityChoice,
  audioQuality: AudioQualityChoice
) {
  if (mediaType === 'video') {
    if (videoQuality === QUALITY_BEST) return 'Best';
    return formatResolutionLabel(videoQuality);
  }
  const abr = audioQuality === QUALITY_BEST ? 320 : audioQuality;
  const preset = AUDIO_QUALITY_OPTIONS.find((o) => o.value === abr);
  return preset?.label ?? `${abr}kbps`;
}

export default function AnalysisFlow({
  url,
  setUrl,
  videoInfo,
  mediaType,
  videoQuality,
  audioQuality,
  analyzing,
  downloading,
  qualityNotice,
  error,
  readyDownload,
  cookiesText = '',
  setCookiesText,
}: AnalysisFlowProps) {
  const author =
    videoInfo?.uploader || videoInfo?.channel || videoInfo?.creator || null;
  const statusText = readyDownload
    ? null
    : analyzing
    ? 'Checking video source…'
    : downloading
      ? 'Preparing your download…'
      : null;
  const mobileHint = mobileDownloadHint();

  return (
    <motion.div
      className="analysis-panel"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease }}
    >
      <div className="analysis-url">
        <Link2 size={18} className="panel-input-icon" strokeWidth={1.5} />
        <input
          type="text"
          className="panel-input"
          placeholder="Paste any video URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          spellCheck={false}
        />
      </div>

      <div className="analysis-media-card">
        <div className="analysis-thumb">
          {videoInfo?.thumbnail ? (
            <img src={videoInfo.thumbnail} alt="" />
          ) : (
            <div className="analysis-thumb-skeleton" />
          )}
        </div>
        <div className="analysis-meta">
          {videoInfo?.title ? (
            <h3 className="analysis-title">{videoInfo.title}</h3>
          ) : (
            <div className="analysis-title-skeleton" />
          )}
          {author ? (
            <p className="analysis-author">{author}</p>
          ) : analyzing || downloading ? (
            <div className="analysis-author-skeleton" />
          ) : null}
          <div className="analysis-badges">
            <span className="analysis-badge">{mediaType === 'video' ? 'MP4' : 'MP3'}</span>
            <span className="analysis-badge">{qualityLabel(mediaType, videoQuality, audioQuality)}</span>
            <span className="analysis-badge">Origin</span>
          </div>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {statusText && (
          <motion.div
            key={statusText}
            className="analysis-status"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.25, ease }}
          >
            <span>{statusText}</span>
            <Loader2 size={18} className="spin analysis-status-spin" />
          </motion.div>
        )}
      </AnimatePresence>

      {readyDownload && (
        <motion.div
          className="analysis-download-wrap"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease }}
        >
          <a
            className="analysis-download-btn"
            href={readyDownload.url}
            rel="noopener noreferrer"
          >
            Tap to save {mediaType === 'video' ? 'MP4' : 'MP3'}
          </a>
          {mobileHint && <p className="analysis-download-hint">{mobileHint}</p>}
        </motion.div>
      )}

      {(qualityNotice || error) && (
        <div className="panel-hero-messages">
          {qualityNotice && <p className="panel-notice">{qualityNotice}</p>}
          {error && <p className="panel-error" role="alert">{error}</p>}
        </div>
      )}

      {setCookiesText && (error || /douyin|tiktok/i.test(url)) && !/youtube\.com|youtu\.be/i.test(url) && (
        <details className="panel-cookies-advanced">
          <summary>Advanced: browser cookies (optional)</summary>
          <p className="panel-cookies-hint">
            Only needed when a platform blocks the server. Export cookies while logged in on that site.
          </p>
          <textarea
            className="panel-cookies-input"
            value={cookiesText}
            onChange={(e) => setCookiesText(e.target.value)}
            placeholder="Paste Netscape cookies.txt content or Cookie: header value"
            rows={3}
            spellCheck={false}
          />
        </details>
      )}
    </motion.div>
  );
}
