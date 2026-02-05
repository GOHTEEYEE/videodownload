'use client';

import { useState } from 'react';
import { Download, Link as LinkIcon, AlertCircle, CheckCircle2, Loader2, Sparkles, Video } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function Home() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [videoInfo, setVideoInfo] = useState<any>(null);
  const [startTime, setStartTime] = useState(0); // in seconds
  const [endTime, setEndTime] = useState(0); // in seconds
  const [error, setError] = useState('');


  const formatTimeDisplay = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(1);
    return `${mins}:${secs.padStart(4, '0')}`;
  };

  const parseTimeToSeconds = (timeStr: string) => {
    const parts = timeStr.split(':');
    if (parts.length === 2) {
      return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
    }
    return parseFloat(timeStr) || 0;
  };

  const handleExtract = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;

    // Fast validation: must look like a URL and not be massive
    if (!trimmedUrl.startsWith('http')) {
      setError('Please enter a valid URL starting with http:// or https://');
      return;
    }

    if (trimmedUrl.length > 1000) {
      setError('URL is too long. Please paste a direct video link.');
      return;
    }

    setLoading(true);
    setError('');
    setVideoInfo(null);

    // Create an AbortController to handle timeouts
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    try {
      const response = await fetch('/api/extract', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: trimmedUrl }),
        signal: controller.signal,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to extract video info');
      }

      setVideoInfo(data);
      if (data.duration) {
        setStartTime(0);
        setEndTime(data.duration);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setError('Request timed out. The video platform might be slow or blocking connections.');
      } else {
        setError(err.message || 'An unexpected error occurred.');
      }
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
    }
  };


  const handleSmartDownload = async (quality: number, formatId?: string) => {
    if (downloadingId) return;

    const id = formatId || 'smart';
    setDownloadingId(id);
    setError('');
    setDownloadProgress(0);

    try {
      const prepareRes = await fetch('/api/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          quality,
          formatId,
          title: videoInfo?.title || 'video',
          start: startTime,
          end: endTime
        })
      });

      if (!prepareRes.ok) throw new Error('Failed to start download job');
      const { jobId } = await prepareRes.json();
      setActiveJobId(jobId);

      let errorCount = 0;
      const pollInterval = setInterval(async () => {
        try {
          const res = await fetch(`/api/progress?jobId=${jobId}`, {
            cache: 'no-store',
            headers: { 'Pragma': 'no-cache' }
          });

          if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);

          const data = await res.json();
          errorCount = 0;

          if (data.progress !== undefined) {
            setDownloadProgress(Math.min(Math.max(data.progress, 0), 100));
          }

          if (data.status === 'done') {
            clearInterval(pollInterval);
            setDownloadProgress(100);

            const downloadUrl = `/api/serve?jobId=${jobId}`;
            const link = document.createElement('a');
            link.href = downloadUrl;
            link.setAttribute('download', '');
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            setTimeout(() => {
              setDownloadingId(null);
              setActiveJobId(null);
              setDownloadProgress(0);
            }, 5000);
          } else if (data.status === 'error') {
            clearInterval(pollInterval);
            setError(data.error || 'Server reported an error during processing.');
            setDownloadingId(null);
            setActiveJobId(null);
          }

        } catch (e: any) {
          errorCount++;
          if (errorCount > 10) {
            clearInterval(pollInterval);
            setError('Connection lost. Please try again.');
            setDownloadingId(null);
          }
        }
      }, 1500);

    } catch (e: any) {
      setError(e.message || 'Failed to initiate download');
      setDownloadingId(null);
    }
  };






  const formatSize = (bytes: number) => {
    if (!bytes) return 'Unknown size';
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 Byte';
    const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)).toString());
    return Math.round(bytes / Math.pow(1024, i)) + ' ' + sizes[i];
  };

  return (
    <main className="container">
      <nav className="navbar">
        <div className="logo">
          <Sparkles className="logo-icon" />
          <span>VibeDownloader</span>
        </div>
      </nav>

      <div className="hero">
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="gradient-text hero-title"
        >
          High-Quality 4K Video Downloader
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="hero-subtitle"
        >
          Paste your video link below to download in 4K resolution with no watermarks.
        </motion.p>

        <motion.form
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          onSubmit={handleExtract}
          className="input-container glass"
        >
          <div className="input-wrapper">
            <LinkIcon className="input-icon" />
            <input
              type="text"
              placeholder="Paste video link here (YouTube, TikTok, Instagram...)"
              className="input-field-custom"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <button type="submit" className="button-primary" disabled={loading || !url}>
            {loading ? <Loader2 className="animate-spin" /> : <Download size={20} />}
            {loading ? 'Analyzing...' : 'Fetch Video'}
          </button>
        </motion.form>

        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="error-message glass"
            >
              <AlertCircle size={20} />
              <span>{error}</span>
            </motion.div>
          )}

          {videoInfo && (
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              className="results-container glass"
            >
              <div className="video-preview">
                {videoInfo.thumbnail ? (
                  <img src={videoInfo.thumbnail} alt={videoInfo.title} className="thumbnail" />
                ) : (
                  <div className="thumbnail-placeholder">
                    <Video size={48} />
                  </div>
                )}
                <div className="video-details">
                  <h3>{videoInfo.title}</h3>
                  <p className="uploader">By {videoInfo.uploader || 'Creator'}</p>

                  <div className="visual-trimmer">
                    <div className="trim-values">
                      <div className="time-box">
                        <input
                          type="text"
                          value={formatTimeDisplay(startTime)}
                          onChange={(e) => setStartTime(parseTimeToSeconds(e.target.value))}
                          className="time-input-large"
                        />
                      </div>
                      <span className="separator">-</span>
                      <div className="time-box">
                        <input
                          type="text"
                          value={formatTimeDisplay(endTime)}
                          onChange={(e) => setEndTime(parseTimeToSeconds(e.target.value))}
                          className="time-input-large"
                        />
                      </div>
                    </div>

                    <div className="timeline-container">
                      <div className="timeline-labels">
                        <span>0:00</span>
                        <span>{formatTimeDisplay(videoInfo.duration / 2)}</span>
                        <span>{formatTimeDisplay(videoInfo.duration)}</span>
                      </div>
                      <div className="timeline-track">
                        <div
                          className="timeline-selection"
                          style={{
                            left: `${(startTime / videoInfo.duration) * 100}%`,
                            width: `${((endTime - startTime) / videoInfo.duration) * 100}%`
                          }}
                        >
                          <div className="selection-handle handle-left" />
                          <div className="selection-center-line" />
                          <div className="selection-handle handle-right" />
                        </div>
                      </div>
                      <div className="duration-label">
                        {(endTime - startTime).toFixed(1)} 秒
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => handleSmartDownload(2160)}
                    className="button-primary smart-download"
                    disabled={!!downloadingId}
                  >
                    {downloadingId === 'smart' ? (
                      <>
                        <Loader2 className="animate-spin" />
                        <span>Starting Download...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles size={18} />
                        <span>Download 4K (MP4)</span>
                      </>
                    )}
                  </button>
                  {downloadingId && (
                    <div className="status-container">
                      <motion.div
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="status-card glass"
                      >
                        {downloadProgress === 100 ? (
                          <CheckCircle2 size={20} className="text-green-500" />
                        ) : (
                          <Loader2 className="animate-spin text-accent" size={20} />
                        )}
                        <div style={{ flex: 1 }}>
                          <p className="status-text-primary">
                            {downloadProgress === 100 
                              ? 'Success! Your download is starting.' 
                              : `Processing: ${downloadProgress.toFixed(1)}%`}
                          </p>
                          <div className="progress-bar-mini-bg">
                            <motion.div
                              className="progress-bar-mini-fill"
                              initial={{ width: 0 }}
                              animate={{ width: `${downloadProgress}%` }}
                              transition={{ duration: 0.3 }}
                            />
                          </div>
                          <p className="status-text-secondary">
                            {downloadProgress === 100 
                              ? 'Check your browser manager.' 
                              : 'Resolving YouTube stream...'}
                          </p>
                        </div>
                      </motion.div>
                      
                      {downloadProgress === 100 && activeJobId && (
                        <motion.div 
                          initial={{ opacity: 0 }} 
                          animate={{ opacity: 1 }}
                          className="manual-download-tip"
                        >
                          <p>Download didn't start? </p>
                          <a href={`/api/serve?jobId=${activeJobId}`} className="download-link-fallback">
                            Click here to save manually
                          </a>
                        </motion.div>
                      )}
                    </div>
                  )}

                </div>
              </div>

              <div className="format-list">
                <div className="format-header">
                  <h4>Available Formats</h4>
                  <div className="badges">
                    <span className="badge">4K Supported</span>
                    {url.includes('tiktok.com') && <span className="badge badge-success">No Watermark Detected</span>}
                    <span className="badge badge-success">High Speed</span>
                  </div>
                </div>

                <div className="formats-grid">
                  {videoInfo.formats
                    .filter((f: any) => (f.vcodec !== 'none' || f.acodec !== 'none') && f.protocol === 'https')
                    .sort((a: any, b: any) => (b.height || 0) - (a.height || 0))
                    .slice(0, 15)
                    .map((format: any, idx: number) => (
                      <div key={idx} className="format-card glass">
                        <div className="format-info">
                          <span className="resolution">
                            {format.height ? `${format.height}p` : 'Audio'}
                            {format.height >= 2160 && <span className="ultra-hd">4K</span>}
                            {format.height >= 1080 && format.height < 2160 && <span className="hd">HD</span>}
                          </span>
                          <span className="ext">{format.ext.toUpperCase()}</span>
                        </div>
                        <div className="format-meta">
                          <span>{format.vcodec !== 'none' && format.acodec !== 'none' ? 'Video + Audio' : format.vcodec !== 'none' ? 'Video only' : 'Audio only'}</span>
                          <span>• {formatSize(format.filesize || format.filesize_approx)}</span>
                        </div>
                        <button
                          disabled={!!downloadingId}
                          className="download-btn-small"
                          onClick={() => handleSmartDownload(format.height || 2160, format.format_id)}
                        >
                          <Download size={14} />
                          {downloadingId === format.format_id ? 'Preparing...' : `Download ${format.height ? `${format.height}p` : 'Audio'}`}
                        </button>

                      </div>
                    ))
                  }
                </div>
              </div>

            </motion.div>
          )}
        </AnimatePresence>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="features-grid"
        >
          <div className="feature-card glass">
            <Sparkles className="feature-icon" />
            <h3>Premium 4K Quality</h3>
            <p>Download videos in their highest available resolution, up to 4K Ultra HD.</p>
          </div>
          <div className="feature-card glass">
            <CheckCircle2 className="feature-icon" />
            <h3>No Watermarks</h3>
            <p>Clean downloads for TikTok, Instagram, and more without annoying watermarks.</p>
          </div>
          <div className="feature-card glass">
            <Loader2 className="feature-icon" />
            <h3>Lightning Fast</h3>
            <p>High-speed extraction and multi-threaded downloading technology.</p>
          </div>
        </motion.div>

        <div className="supported-platforms">
          <p>Supported Platforms</p>
          <div className="platform-icons">
            <span className="platform-tag">YouTube</span>
            <span className="platform-tag">TikTok</span>
            <span className="platform-tag">Instagram</span>
            <span className="platform-tag">Twitter (X)</span>
            <span className="platform-tag">Facebook</span>
            <span className="platform-tag">Vimeo</span>
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="browser-tip glass"
        >
          <div className="tip-header">
            <CheckCircle2 size={16} className="logo-icon" />
            <span>Pro Tip: Choose your Save Location</span>
          </div>
          <p>Want to choose where your videos save? Enable <strong>"Ask where to save each file before downloading"</strong> in your browser settings (Chrome/Safari) to pick a folder every time.</p>
        </motion.div>
      </div>

      <style jsx>{`
        .container {
          max-width: 1000px;
          margin: 0 auto;
          padding: 0 20px;
          min-height: 100vh;
        }

        .navbar {
          height: 80px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .logo {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 24px;
          font-weight: 700;
          letter-spacing: -0.5px;
        }

        .logo-icon {
          color: var(--accent);
        }

        .hero {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          padding: 80px 0;
        }

        .hero-title {
          font-size: 64px;
          font-weight: 800;
          margin-bottom: 20px;
          line-height: 1.1;
        }

        .hero-subtitle {
          font-size: 20px;
          color: var(--muted);
          margin-bottom: 40px;
          max-width: 600px;
        }

        .input-container {
          width: 100%;
          max-width: 800px;
          padding: 8px;
          display: flex;
          gap: 8px;
          margin-bottom: 24px;
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.4);
        }

        .input-wrapper {
          flex: 1;
          position: relative;
          display: flex;
          align-items: center;
        }

        .input-icon {
          position: absolute;
          left: 16px;
          color: var(--muted);
        }

        .input-field-custom {
          width: 100%;
          background: transparent;
          border: none;
          color: white;
          padding: 16px 16px 16px 50px;
          font-size: 18px;
          outline: none;
        }

        .error-message {
          display: flex;
          align-items: center;
          gap: 12px;
          color: #ff4d4d;
          padding: 16px 24px;
          margin-top: 20px;
          border-color: rgba(255, 77, 77, 0.2);
        }

        .results-container {
          width: 100%;
          max-width: 800px;
          margin-top: 40px;
          padding: 30px;
          text-align: left;
          box-shadow: 0 30px 60px rgba(0, 0, 0, 0.5);
        }

        .video-preview {
          display: flex;
          gap: 24px;
          margin-bottom: 40px;
          align-items: center;
        }

        .thumbnail {
          width: 240px;
          aspect-ratio: 16/9;
          object-fit: cover;
          border-radius: 8px;
          border: 1px solid var(--border);
        }

        .thumbnail-placeholder {
          width: 240px;
          aspect-ratio: 16/9;
          background: var(--secondary);
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--muted);
        }

        .video-details h3 {
          font-size: 24px;
          margin-bottom: 8px;
          line-height: 1.3;
        }

        .uploader {
          color: var(--muted);
          font-size: 16px;
          margin-bottom: 20px;
        }

        .visual-trimmer {
          width: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 24px;
          margin-bottom: 30px;
          background: rgba(0, 0, 0, 0.2);
          padding: 24px;
          border-radius: 16px;
        }

        .trim-values {
          display: flex;
          align-items: center;
          gap: 20px;
        }

        .time-box {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          padding: 10px 20px;
          min-width: 140px;
          text-align: center;
        }

        .time-input-large {
          background: transparent;
          border: none;
          color: white;
          font-size: 32px;
          font-weight: 600;
          width: 120px;
          text-align: center;
          outline: none;
        }

        .separator {
          font-size: 24px;
          color: var(--muted);
        }

        .timeline-container {
          width: 100%;
          position: relative;
        }

        .timeline-labels {
          display: flex;
          justify-content: space-between;
          font-size: 14px;
          color: var(--muted);
          margin-bottom: 8px;
        }

        .timeline-track {
          width: 100%;
          height: 60px;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 8px;
          position: relative;
          overflow: hidden;
          background-image: linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px);
          background-size: 10% 100%;
        }

        .timeline-selection {
          position: absolute;
          top: 0;
          height: 100%;
          background: rgba(0, 112, 243, 0.3);
          border: 2px solid #0070f3;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .selection-handle {
          position: absolute;
          width: 12px;
          height: 30px;
          background: #0070f3;
          border-radius: 2px;
        }

        .handle-left { left: 4px; }
        .handle-right { right: 4px; }

        .selection-center-line {
          width: 2px;
          height: 100%;
          background: #ff0000;
          box-shadow: 0 0 10px rgba(255, 0, 0, 0.5);
        }

        .duration-label {
          margin-top: 12px;
          font-size: 16px;
          font-weight: 600;
          color: var(--muted);
        }

        .smart-download {
          padding: 14px 28px;
          font-size: 16px;
          box-shadow: 0 10px 20px rgba(0, 112, 243, 0.3);
          width: 100%;
        }

        .status-container {
          margin-top: 20px;
          width: 100%;
        }

        .status-card {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 16px 20px;
          border-radius: 12px;
          background: rgba(0, 112, 243, 0.1);
          border: 1px solid rgba(0, 112, 243, 0.2);
          text-align: left;
        }

        .status-text-primary {
          font-weight: 600;
          font-size: 14px;
          color: white;
          margin: 0;
        }

        .status-text-secondary {
          font-size: 12px;
          color: var(--muted);
          margin: 4px 0 0 0;
        }

        .progress-bar-mini-bg {
          width: 100%;
          height: 4px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 2px;
          margin-top: 8px;
          overflow: hidden;
        }

        .progress-bar-mini-fill {
          height: 100%;
          background: var(--accent);
          border-radius: 2px;
          transition: width 0.3s ease;
        }

        .log-console {
          margin-top: 15px;
          background: rgba(0, 0, 0, 0.7);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          overflow: hidden;
          font-family: 'Courier New', Courier, monospace;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
          width: 100%;
          max-width: 500px;
          margin-left: auto;
          margin-right: auto;
        }

        .console-header {
          background: rgba(255, 255, 255, 0.05);
          padding: 8px 12px;
          display: flex;
          align-items: center;
          gap: 6px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }

        .console-header span {
          font-size: 11px;
          color: rgba(255, 255, 255, 0.5);
          text-transform: uppercase;
          letter-spacing: 1px;
          margin-left: 6px;
        }

        .dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }
        .dot.red { background: #ff5f56; }
        .dot.yellow { background: #ffbd2e; }
        .dot.green { background: #27c93f; }

        .console-body {
          padding: 12px;
          max-height: 200px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .log-line {
          font-size: 12px;
          color: #00ff00;
          text-shadow: 0 0 5px rgba(0, 255, 0, 0.3);
          line-height: 1.4;
          display: flex;
          gap: 8px;
        }

        .log-line::before {
          content: '>';
          opacity: 0.5;
        }

        .hint {
          font-size: 11px;
          color: rgba(255, 255, 255, 0.4);
          margin-top: 10px;
          text-align: center;
          font-style: italic;
        }

        .download-progress-container {
          margin-top: 15px;
          background: rgba(0, 112, 243, 0.1);
          border: 1px solid rgba(0, 112, 243, 0.3);
          border-radius: 8px;
          padding: 12px;
          max-width: 500px;
          margin-left: auto;
          margin-right: auto;
        }

        .progress-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 8px;
          font-size: 13px;
          color: var(--accent);
          font-weight: 600;
        }

        .progress-bar-bg {
          width: 100%;
          height: 8px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 4px;
          overflow: hidden;
        }

        .progress-bar-fill {
          height: 100%;
          background: linear-gradient(90deg, #0070f3, #00d4ff);
          border-radius: 4px;
          transition: width 0.3s ease;
          box-shadow: 0 0 10px rgba(0, 112, 243, 0.5);
        }

        .manual-download-tip {
          margin-top: 12px;
          padding-top: 12px;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
          font-size: 13px;
          color: var(--muted);
          text-align: center;
        }

        .download-link-fallback {
          display: inline-block;
          margin-top: 8px;
          color: var(--accent);
          text-decoration: underline;
          font-weight: 600;
          cursor: pointer;
        }

        .download-link-fallback:hover {
          color: white;
        }




        .format-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
        }

        .badges {
          display: flex;
          gap: 8px;
        }

        .badge {
          background: rgba(0, 112, 243, 0.1);
          color: var(--accent);
          padding: 4px 12px;
          border-radius: 100px;
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          border: 1px solid rgba(0, 112, 243, 0.2);
        }

        .badge-success {
          background: rgba(0, 255, 128, 0.1);
          color: #00ff80;
          border-color: rgba(0, 255, 128, 0.2);
        }

        .formats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 16px;
        }

        .format-card {
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.05);
          transition: transform 0.2s, background 0.2s;
        }

        .format-card:hover {
          background: rgba(255, 255, 255, 0.04);
          border-color: rgba(255, 255, 255, 0.1);
          transform: translateY(-2px);
        }

        .format-info {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .resolution {
          font-weight: 700;
          font-size: 18px;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .ultra-hd {
          font-size: 9px;
          background: #ffaa00;
          color: black;
          padding: 1px 5px;
          border-radius: 3px;
          font-weight: 900;
        }

        .hd {
          font-size: 9px;
          background: var(--accent);
          color: white;
          padding: 1px 5px;
          border-radius: 3px;
          font-weight: 900;
        }

        .ext {
          color: var(--muted);
          font-size: 12px;
          font-weight: 600;
        }

        .format-meta {
          color: var(--muted);
          font-size: 13px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .download-btn-small {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          background: white;
          color: black;
          padding: 8px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          transition: opacity 0.2s;
        }

        .download-btn-small:hover {
          opacity: 0.9;
        }

        .features-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 24px;
          margin-top: 80px;
          width: 100%;
          max-width: 900px;
        }

        .feature-card {
          padding: 30px;
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
        }

        .feature-icon {
          color: var(--accent);
          width: 32px;
          height: 32px;
        }

        .feature-card h3 {
          font-size: 18px;
          font-weight: 700;
        }

        .feature-card p {
          color: var(--muted);
          font-size: 14px;
          line-height: 1.6;
        }

        .supported-platforms {
          margin-top: 80px;
          color: var(--muted);
          margin-bottom: 40px;
        }

        .browser-tip {
          max-width: 600px;
          padding: 20px;
          margin-top: 40px;
          border-color: rgba(0, 112, 243, 0.2);
          text-align: left;
        }

        .tip-header {
          display: flex;
          align-items: center;
          gap: 10px;
          font-weight: 700;
          font-size: 14px;
          margin-bottom: 8px;
          color: white;
        }

        .browser-tip p {
          font-size: 13px;
          color: var(--muted);
          line-height: 1.5;
        }

        .platform-icons {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 12px;
          margin-top: 20px;
        }

        .platform-tag {
          background: rgba(255, 255, 255, 0.05);
          padding: 8px 16px;
          border-radius: 100px;
          font-size: 14px;
          font-weight: 600;
          border: 1px solid rgba(255, 255, 255, 0.1);
        }

        @media (max-width: 768px) {
          .hero-title {
            font-size: 40px;
          }
          .input-container {
            flex-direction: column;
          }
          .video-preview {
            flex-direction: column;
            text-align: center;
          }
          .thumbnail {
            width: 100%;
          }
          .features-grid {
            grid-template-columns: 1fr;
          }
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .animate-spin {
          animation: spin 1s linear infinite;
        }
      `}</style>
    </main>
  );
}
