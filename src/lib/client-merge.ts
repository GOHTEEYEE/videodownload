'use client';

import {
  fetchBlobThroughProxy,
  type ProxyStreamOptions,
} from '@/lib/download-client';

/** Combine separate video + audio streams into one MP4 in the browser (no server ffmpeg). */
export async function mergeVideoAudioInBrowser(
  videoSource: ProxyStreamOptions | string,
  audioSource: ProxyStreamOptions | string,
  onProgress?: (message: string) => void
): Promise<Blob> {
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  const { fetchFile, toBlobURL } = await import('@ffmpeg/util');

  const loadStream = async (source: ProxyStreamOptions | string) => {
    if (typeof source === 'string') {
      return fetchFile(source);
    }
    const blob = await fetchBlobThroughProxy(source);
    return new Uint8Array(await blob.arrayBuffer());
  };

  const ffmpeg = new FFmpeg();
  ffmpeg.on('log', ({ message }) => {
    if (message.includes('Error') || message.includes('error')) {
      console.warn('[ffmpeg]', message);
    }
  });

  onProgress?.('Loading video tools…');
  const coreVersion = '0.12.6';
  const base = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${coreVersion}/dist/umd`;
  await ffmpeg.load({
    coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
  });

  onProgress?.('Downloading video…');
  await ffmpeg.writeFile('video.mp4', await loadStream(videoSource));

  onProgress?.('Downloading audio…');
  await ffmpeg.writeFile('audio.m4a', await loadStream(audioSource));

  onProgress?.('Combining video and audio…');
  const copyExit = await ffmpeg.exec([
    '-i',
    'video.mp4',
    '-i',
    'audio.m4a',
    '-c',
    'copy',
    '-movflags',
    '+faststart',
    'out.mp4',
  ]);

  if (copyExit !== 0) {
    onProgress?.('Re-encoding for compatibility…');
    await ffmpeg.exec([
      '-i',
      'video.mp4',
      '-i',
      'audio.m4a',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-movflags',
      '+faststart',
      'out.mp4',
    ]);
  }

  const output = await ffmpeg.readFile('out.mp4');
  const bytes =
    output instanceof Uint8Array ? output : new TextEncoder().encode(String(output));
  return new Blob([bytes as BlobPart], { type: 'video/mp4' });
}

export function downloadBlob(blob: Blob, filename: string): boolean {
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  return true;
}
