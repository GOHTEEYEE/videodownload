import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import youtubedl from 'youtube-dl-exec';

const bundledYtDlpPath = path.join(
  process.cwd(),
  'node_modules',
  'youtube-dl-exec',
  'bin',
  'yt-dlp'
);

const projectYtDlpPath = path.join(process.cwd(), 'bin', 'yt-dlp');

export function getYtDlpPath(): string {
  if (fs.existsSync(projectYtDlpPath)) {
    return projectYtDlpPath;
  }

  if (fs.existsSync(bundledYtDlpPath)) {
    return bundledYtDlpPath;
  }

  try {
    const localPath = `${process.cwd()}/yt-dlp`;
    if (fs.existsSync(localPath)) {
      return localPath;
    }
    const fromPath = execSync('which yt-dlp').toString().trim();
    if (fromPath && fs.existsSync(fromPath)) {
      return fromPath;
    }
  } catch {
    // fall through
  }

  for (const candidate of ['/usr/local/bin/yt-dlp', '/opt/homebrew/bin/yt-dlp']) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return bundledYtDlpPath;
}

export function createYtDlp() {
  return youtubedl.create(getYtDlpPath());
}
