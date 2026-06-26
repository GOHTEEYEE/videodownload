import { chmod, mkdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';

const binDir = path.join(process.cwd(), 'bin');
const dest = path.join(binDir, 'yt-dlp');

const asset =
  process.platform === 'darwin'
    ? 'yt-dlp_macos'
    : process.platform === 'win32'
      ? 'yt-dlp.exe'
      : 'yt-dlp_linux';

const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`;

async function main() {
  await mkdir(binDir, { recursive: true });
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download yt-dlp (${response.status})`);
  }
  await pipeline(response.body, createWriteStream(dest));
  await chmod(dest, 0o755);
  console.log(`[setup-ytdlp] Installed ${asset} -> ${dest}`);
}

main().catch((error) => {
  console.warn('[setup-ytdlp] Skipped:', error instanceof Error ? error.message : error);
  process.exit(0);
});
