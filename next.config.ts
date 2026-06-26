import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  compress: true,
  poweredByHeader: false,
  reactStrictMode: true,
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
      { protocol: 'http', hostname: '**' },
    ],
  },
  serverExternalPackages: ['puppeteer', 'puppeteer-extra', 'puppeteer-extra-plugin-stealth'],
  experimental: {
    optimizePackageImports: ['lucide-react', 'framer-motion'],
  },
  outputFileTracingExcludes: {
    '*': ['./venv/**', './test-*.js', './debug-*.js', './analyze-*.js'],
  },
  outputFileTracingIncludes: {
    '/api/**/*': [
      './node_modules/youtube-dl-exec/bin/**',
      './node_modules/ffmpeg-static/**',
      './bin/**',
    ],
  },
};

export default nextConfig;
