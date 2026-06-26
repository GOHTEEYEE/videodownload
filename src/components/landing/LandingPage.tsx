'use client';

import { motion } from 'framer-motion';
import {
  Zap,
  Sparkles,
  Shield,
  MoreHorizontal,
} from 'lucide-react';
import DownloadPanel, {
  type MediaType,
  type SubtitleLanguage,
} from '@/components/download/DownloadPanel';
import type { VideoInfo } from '@/components/download/AnalysisFlow';
import type { ReadyDownload } from '@/lib/download-client';
import type { VideoQualityChoice, AudioQualityChoice } from '@/lib/quality';
import {
  TikTokIcon,
  InstagramIcon,
  FacebookIcon,
  YouTubeIcon,
} from '@/components/landing/PlatformIcons';

const ease = [0.25, 0.1, 0.25, 1] as const;

const fade = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease } },
};

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } },
};

const features = [
  {
    icon: Zap,
    title: 'Ultra-fast extraction',
    desc: 'Most links ready in under 10 seconds.',
  },
  {
    icon: Sparkles,
    title: 'Original Quality',
    desc: 'Full resolution streams when available.',
  },
  {
    icon: Shield,
    title: 'No Watermark',
    desc: 'Clean downloads from supported sources.',
  },
];

const trustStats = [
  { value: '2M+', label: 'Downloads' },
  { value: '50+', label: 'Platforms' },
  { value: '99.9%', label: 'Uptime' },
];

const platforms: Array<{
  label: string;
  slug: string;
  icon?: typeof TikTokIcon;
}> = [
  { label: 'TikTok', icon: TikTokIcon, slug: 'tiktok' },
  { label: 'Instagram', icon: InstagramIcon, slug: 'instagram' },
  { label: 'Facebook', icon: FacebookIcon, slug: 'facebook' },
  { label: 'YouTube', icon: YouTubeIcon, slug: 'youtube' },
  { label: 'More', slug: 'more' },
];

interface LandingPageProps {
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
  downloadFlowActive?: boolean;
  qualityNotice: string | null;
  error: string | null;
  readyDownload?: ReadyDownload | null;
  onDownload: () => void;
}

export default function LandingPage(props: LandingPageProps) {
  const inFlow = props.downloadFlowActive;

  return (
    <main className="landing">
      <div className="landing-glow" aria-hidden />
      <div className="landing-wrap">
        <motion.section
          className="hero-centered"
          variants={stagger}
          initial="hidden"
          animate="show"
        >
          <motion.div className="hero-badge" variants={fade}>
            <Zap size={13} className="hero-badge-icon" fill="currentColor" />
            Premium media downloader
          </motion.div>

          <motion.h1 className="hero-headline hero-headline--centered" variants={fade}>
            Download anything.
            <br />
            <span className="text-gradient">Without the friction.</span>
          </motion.h1>

          <motion.p className="hero-sub hero-sub--centered" variants={fade}>
            Paste a link, choose your format and quality — download in seconds.
          </motion.p>

          <motion.div className="hero-panel-wrap" variants={fade}>
            <DownloadPanel {...props} variant="hero" />
          </motion.div>

          {!inFlow && (
            <>
          <motion.div className="hero-platforms" variants={fade}>
            {platforms.map((p) => (
              <span key={p.label} className="hero-platform-pill">
                <span className={`hero-platform-mark platform-logo-${p.slug}`}>
                  {p.slug === 'more' ? (
                    <MoreHorizontal size={18} strokeWidth={2} />
                  ) : p.icon ? (
                    <p.icon size={18} />
                  ) : null}
                </span>
                <span className="hero-platform-label">{p.label}</span>
              </span>
            ))}
          </motion.div>

          <motion.div className="hero-features" variants={fade}>
            {features.map((f) => (
              <article key={f.title} className="hero-feature-card">
                <f.icon size={18} strokeWidth={1.75} className="hero-feature-icon" />
                <div>
                  <h3 className="hero-feature-title">{f.title}</h3>
                  <p className="hero-feature-desc">{f.desc}</p>
                </div>
              </article>
            ))}
          </motion.div>

          <motion.div className="hero-stats" variants={fade}>
            {trustStats.map((s) => (
              <div key={s.label} className="hero-stat">
                <span className="hero-stat-value">{s.value}</span>
                <span className="hero-stat-label">{s.label}</span>
              </div>
            ))}
          </motion.div>
            </>
          )}
        </motion.section>
      </div>
    </main>
  );
}
