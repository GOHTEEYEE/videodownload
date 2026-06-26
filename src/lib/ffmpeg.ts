import fs from 'fs';

export function getFfmpegPath(): string | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ffmpegStatic = require('ffmpeg-static') as string | null;
    if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
      return ffmpegStatic;
    }
  } catch {
    // optional dependency fallback
  }

  for (const candidate of [
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/usr/bin/ffmpeg',
  ]) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}
