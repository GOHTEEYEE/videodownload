'use client';

import { useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, Check, Loader2 } from 'lucide-react';
import {
  getPlatformName,
  formatDuration,
  formatViewCount,
} from '@/lib/formats';
import {
  VIDEO_QUALITY_PRESETS,
  AUDIO_BITRATE_PRESETS,
  resolveVideoQuality,
  resolveAudioBitrate,
  type VideoQualityChoice,
  type AudioQualityChoice,
} from '@/lib/quality';

type MediaType = 'video' | 'audio';

export type DownloadPreferences = {
  mediaType: MediaType;
  preferredHeight: number;
  preferredBitrate: number;
};

interface ResultsViewProps {
  videoInfo: any;
  mediaType: MediaType;
  setMediaType: (t: MediaType) => void;
  preferredHeight: VideoQualityChoice;
  setPreferredHeight: (h: VideoQualityChoice) => void;
  preferredBitrate: AudioQualityChoice;
  setPreferredBitrate: (b: AudioQualityChoice) => void;
  qualityNotice: string | null;
  downloadingId: string | null;
  onBack: () => void;
  onDownload: () => void;
}

const ease = [0.25, 0.1, 0.25, 1] as const;

const panelVariants = {
  initial: { opacity: 0, scale: 0.98, height: 0 },
  animate: { opacity: 1, scale: 1, height: 'auto', transition: { duration: 0.35, ease } },
  exit: { opacity: 0, scale: 0.98, height: 0, transition: { duration: 0.25, ease } },
};

export default function ResultsView({
  videoInfo,
  mediaType,
  setMediaType,
  preferredHeight,
  setPreferredHeight,
  preferredBitrate,
  setPreferredBitrate,
  qualityNotice,
  downloadingId,
  onBack,
  onDownload,
}: ResultsViewProps) {
  const formats = videoInfo.formats || [];
  const extractorKey = videoInfo.extractor_key;

  const platform = getPlatformName(extractorKey, videoInfo.webpage_url);
  const views = formatViewCount(videoInfo.view_count);
  const author = videoInfo.uploader || videoInfo.channel || videoInfo.creator;

  const videoResolution = useMemo(
    () => resolveVideoQuality(preferredHeight, formats, extractorKey),
    [preferredHeight, formats, extractorKey]
  );

  const audioResolution = useMemo(
    () => resolveAudioBitrate(preferredBitrate, formats),
    [preferredBitrate, formats]
  );

  const activeNotice =
    qualityNotice ||
    (mediaType === 'video' ? videoResolution.notice : audioResolution.notice);

  return (
    <div className="results-page">
      <div className="results-inner">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease }}
        >
          <button type="button" className="results-back" onClick={onBack}>
            <ArrowLeft size={14} />
            New link
          </button>

          <div className="media-card">
            <div className="media-preview">
              {videoInfo.thumbnail ? (
                <img src={videoInfo.thumbnail} alt="" />
              ) : (
                <div className="media-preview-fallback" />
              )}
            </div>

            <div className="media-meta">
              <span className="media-platform">{platform}</span>
              <h2 className="media-title">{videoInfo.title}</h2>

              <div className="media-stats">
                {[
                  videoInfo.duration > 0 ? formatDuration(videoInfo.duration) : null,
                  views,
                  author,
                ]
                  .filter(Boolean)
                  .map((item, i, arr) => (
                    <span key={i}>
                      {item}
                      {i < arr.length - 1 && <span className="stat-dot"> · </span>}
                    </span>
                  ))}
              </div>
            </div>
          </div>

          <div className="download-panel">
            <p className="panel-section-label">Choose format</p>

            <div className="segmented-control">
              {(['video', 'audio'] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  className={`segment ${mediaType === type ? 'active' : ''}`}
                  onClick={() => setMediaType(type)}
                >
                  {mediaType === type && (
                    <motion.span
                      className="segment-bg"
                      layoutId="segment-bg"
                      transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                    />
                  )}
                  <span className="segment-label">{type === 'video' ? 'MP4' : 'MP3'}</span>
                </button>
              ))}
            </div>

            <AnimatePresence mode="wait">
              {mediaType === 'video' ? (
                <motion.div
                  key="video-options"
                  className="format-section"
                  variants={panelVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                >
                  <p className="panel-section-label">Quality</p>
                  <div className="quality-grid">
                    {VIDEO_QUALITY_PRESETS.map((preset) => (
                      <QualityOption
                        key={preset.height}
                        label={preset.label}
                        selected={preferredHeight === preset.height}
                        onSelect={() => setPreferredHeight(preset.height as VideoQualityChoice)}
                      />
                    ))}
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="audio-options"
                  className="format-section"
                  variants={panelVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                >
                  <p className="panel-section-label">Bitrate</p>
                  <div className="quality-grid">
                    {AUDIO_BITRATE_PRESETS.map((preset) => (
                      <QualityOption
                        key={preset.abr}
                        label={preset.label}
                        selected={preferredBitrate === preset.abr}
                        onSelect={() => setPreferredBitrate(preset.abr as AudioQualityChoice)}
                      />
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {activeNotice && (
                <motion.p
                  className="quality-notice"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                >
                  {activeNotice}
                </motion.p>
              )}
            </AnimatePresence>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease }}
            >
              <button
                type="button"
                className="download-cta"
                onClick={onDownload}
                disabled={downloadingId !== null}
              >
                {downloadingId ? (
                  <>
                    <Loader2 size={18} className="spin" />
                    Preparing download
                  </>
                ) : (
                  'Download now'
                )}
              </button>
            </motion.div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

function QualityOption({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`quality-option ${selected ? 'selected' : ''}`}
      onClick={onSelect}
    >
      <span>{label}</span>
      {selected && <Check size={14} className="format-check" />}
    </button>
  );
}
