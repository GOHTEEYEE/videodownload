'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import LandingPage from '@/components/landing/LandingPage';
import SiteNav from '@/components/landing/SiteNav';
import SiteFooter from '@/components/landing/SiteFooter';
import type { MediaType, SubtitleLanguage } from '@/components/download/DownloadPanel';
import {
  resolveVideoQuality,
  resolveAudioBitrate,
  QUALITY_BEST,
  type VideoQualityChoice,
  type AudioQualityChoice,
} from '@/lib/quality';
import {
  triggerBrowserDownload,
  toAbsoluteDownloadUrl,
  type ReadyDownload,
} from '@/lib/download-client';

interface BackgroundJob {
  id: string;
  title: string;
  thumbnail: string;
  progress: number;
  status: 'processing' | 'done' | 'error';
  url?: string;
  downloadUrl?: string;
  ext?: string;
}

function cleanUrl(raw: string): string {
  return (
    raw
      .trim()
      .match(/https?:\/\/[^\s<>"']+/i)?.[0]
      ?.replace(/[,.;:!?，。！？、]+$/u, '') || raw.trim()
  );
}

export default function Home() {
  const [url, setUrl] = useState('');
  const [videoInfo, setVideoInfo] = useState<any>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [mediaType, setMediaType] = useState<MediaType>('video');
  const [videoQuality, setVideoQuality] = useState<VideoQualityChoice>(QUALITY_BEST);
  const [audioQuality, setAudioQuality] = useState<AudioQualityChoice>(QUALITY_BEST);
  const [subtitleLanguage, setSubtitleLanguage] = useState<SubtitleLanguage>('original');
  const [qualityNotice, setQualityNotice] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [backgroundJobs, setBackgroundJobs] = useState<BackgroundJob[]>([]);
  const [cookiesText, setCookiesText] = useState('');
  const [downloadFlowActive, setDownloadFlowActive] = useState(false);
  const [readyDownload, setReadyDownload] = useState<ReadyDownload | null>(null);
  const extractUrlRef = useRef<string>('');

  useEffect(() => {
    const saved = localStorage.getItem('douyin_cookies');
    if (saved) setCookiesText(saved);
  }, []);

  useEffect(() => {
    if (cookiesText) localStorage.setItem('douyin_cookies', cookiesText);
  }, [cookiesText]);

  const extractMetadata = useCallback(async (inputUrl: string) => {
    const cleaned = cleanUrl(inputUrl);
    if (!cleaned.startsWith('http')) return null;

    setAnalyzing(true);
    setError('');
    try {
      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: cleaned, cookiesText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to analyze video');
      extractUrlRef.current = cleaned;
      setVideoInfo(data);
      return data;
    } catch (err: unknown) {
      setVideoInfo(null);
      extractUrlRef.current = '';
      const message =
        err instanceof Error ? err.message : 'Failed to analyze video';
      setError(message);
      setDownloadFlowActive(false);
      return null;
    } finally {
      setAnalyzing(false);
    }
  }, [cookiesText]);

  useEffect(() => {
    const cleaned = cleanUrl(url);
    if (!cleaned.startsWith('http')) {
      setVideoInfo(null);
      extractUrlRef.current = '';
      setDownloadFlowActive(false);
    }
  }, [url]);

  const offerDownload = (downloadUrl: string, filename: string) => {
    const absoluteUrl = toAbsoluteDownloadUrl(downloadUrl);
    const started = triggerBrowserDownload(absoluteUrl, filename);
    if (!started) {
      setReadyDownload({ url: absoluteUrl, filename });
      requestAnimationFrame(() => {
        document.querySelector('.analysis-download-btn')?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      });
    }
  };

  const updateJobStatus = (id: string, status: BackgroundJob['status'], progress?: number) => {
    setBackgroundJobs((prev) =>
      prev.map((job) =>
        job.id === id ? { ...job, status, progress: progress ?? job.progress } : job
      )
    );
  };

  const updateJobFields = (id: string, fields: Partial<BackgroundJob>) => {
    setBackgroundJobs((prev) =>
      prev.map((job) => (job.id === id ? { ...job, ...fields } : job))
    );
  };

  const pollProgress = (jobId: string, filename: string, ext: string) => {
    let idlePolls = 0;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/progress?jobId=${jobId}`);
        const data = await res.json();

        if (data.progress !== undefined && data.progress > 0) {
          updateJobStatus(jobId, 'processing', data.progress);
          idlePolls = 0;
        } else if (data.status === 'processing') {
          idlePolls += 1;
        }

        if (data.qualityNotice) {
          setQualityNotice(data.qualityNotice);
        }

        if (data.status === 'done') {
          clearInterval(interval);
          setDownloading(false);
          const downloadUrl = data.downloadUrl || `/api/serve?jobId=${jobId}`;
          updateJobFields(jobId, { status: 'done', progress: 100, downloadUrl });

          offerDownload(downloadUrl, data.filename || `${filename}.${ext}`);
        } else if (data.status === 'error') {
          clearInterval(interval);
          setDownloading(false);
          updateJobStatus(jobId, 'error');
          setError(data.error || 'Processing failed');
        } else if (idlePolls >= 90) {
          clearInterval(interval);
          setDownloading(false);
          updateJobStatus(jobId, 'error');
          setError('Download timed out. Please try again or choose a lower quality.');
        }
      } catch {
        clearInterval(interval);
        setDownloading(false);
        updateJobStatus(jobId, 'error');
      }
    }, 1000);
  };

  const handleDownload = async () => {
    const cleaned = cleanUrl(url);
    if (!cleaned) return;

    setError('');
    setQualityNotice(null);
    setReadyDownload(null);
    setDownloadFlowActive(true);

    let info = videoInfo;
    if (!info || extractUrlRef.current !== cleaned) {
      info = await extractMetadata(cleaned);
      if (!info) return;
    }

    const formats = info.formats || [];
    const resolved =
      mediaType === 'video'
        ? resolveVideoQuality(videoQuality, formats, info.extractor_key)
        : resolveAudioBitrate(audioQuality, formats);

    setQualityNotice(resolved.notice);

    const jobId = Math.random().toString(36).substring(7);
    const title = (info.title || 'download').replace(/[<>:"/\\|?*]/g, '').trim() || 'download';
    const ext = mediaType === 'audio' ? 'mp3' : 'mp4';
    const enableTranslate = subtitleLanguage !== 'original' && mediaType === 'video';

    setBackgroundJobs((prev) => [
      {
        id: jobId,
        title,
        thumbnail: info.thumbnail,
        progress: 0,
        status: 'processing',
        url: info.webpage_url || cleaned,
        ext,
      },
      ...prev,
    ]);
    setDownloading(true);

    try {
      const res = await fetch('/api/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId,
          url: info.webpage_url || cleaned,
          streamUrl: resolved.format?.url,
          formatExt: resolved.format?.ext,
          formatId: resolved.format?.format_id,
          needsAudioMerge: mediaType === 'video' ? resolved.needsAudioMerge : false,
          quality: resolved.actual,
          preferredHeight: mediaType === 'video' ? videoQuality : undefined,
          preferredBitrate: mediaType === 'audio' ? audioQuality : undefined,
          formats,
          title,
          mediaType,
          enableTranslate,
          subtitleLanguage,
          cookiesText,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Download failed');

      if (data.direct && data.downloadUrl) {
        setDownloading(false);
        updateJobFields(jobId, {
          status: 'done',
          progress: 100,
          downloadUrl: data.downloadUrl,
        });
        if (data.qualityNotice) setQualityNotice(data.qualityNotice);
        offerDownload(data.downloadUrl, `${title}.${ext}`);
        return;
      }

      pollProgress(jobId, title, ext);
    } catch (err: unknown) {
      setDownloading(false);
      updateJobStatus(jobId, 'error');
      setError(err instanceof Error ? err.message : 'Download failed. Please try again.');
    }
  };

  const showLanguage = mediaType === 'video';

  const focusSearch = () => {
    document.querySelector<HTMLInputElement>('.panel-input')?.focus();
  };

  return (
    <div className="app-shell">
      <SiteNav onGetStarted={focusSearch} />

      <LandingPage
        url={url}
        setUrl={setUrl}
        mediaType={mediaType}
        setMediaType={setMediaType}
        videoQuality={videoQuality}
        setVideoQuality={setVideoQuality}
        audioQuality={audioQuality}
        setAudioQuality={setAudioQuality}
        subtitleLanguage={subtitleLanguage}
        setSubtitleLanguage={setSubtitleLanguage}
        showLanguage={showLanguage}
        videoTitle={videoInfo?.title}
        videoInfo={videoInfo}
        analyzing={analyzing}
        downloading={downloading}
        downloadFlowActive={downloadFlowActive}
        qualityNotice={qualityNotice}
        error={error}
        readyDownload={readyDownload}
        onDownload={handleDownload}
      />

      <SiteFooter />

      {backgroundJobs.length > 0 && (
        <div className="queue-panel">
          <div className="queue-header">
            <span className="queue-title">Downloads</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {backgroundJobs.length}
            </span>
          </div>
          <div className="queue-list">
            {backgroundJobs.map((job) => (
              <div key={job.id} className="queue-item">
                <div className="queue-thumb">
                  {job.thumbnail ? (
                    <img src={job.thumbnail} alt="" />
                  ) : (
                    <div style={{ width: '100%', height: '100%', background: '#f1f5f9' }} />
                  )}
                  {job.status === 'processing' && (
                    <div className="queue-thumb-overlay">
                      <Loader2 size={12} className="spin" />
                    </div>
                  )}
                </div>
                <div className="queue-info">
                  <div className="queue-name">{job.title}</div>
                  <div className="queue-bar">
                    <div className="queue-fill" style={{ width: `${job.progress}%` }} />
                  </div>
                  <div className="queue-status">
                    {job.status === 'done'
                      ? 'Complete'
                      : job.status === 'error'
                        ? 'Failed'
                        : `${Math.round(job.progress)}%`}
                  </div>
                  {job.status === 'done' && job.downloadUrl && (
                    <a
                      className="queue-download-btn"
                      href={toAbsoluteDownloadUrl(job.downloadUrl)}
                    >
                      Tap to save file
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
