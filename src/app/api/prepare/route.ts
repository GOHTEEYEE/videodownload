import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import os from 'os';
import youtubedl from 'youtube-dl-exec';

// Re-use the global store from other routes
const getLogStore = () => {
    const globalAny: any = globalThis;
    if (!globalAny.jobLogs) globalAny.jobLogs = {};
    return globalAny.jobLogs;
};

// Cache for job metadata (status, filename, path)
const getJobCache = () => {
    const globalAny: any = globalThis;
    if (!globalAny.jobCache) globalAny.jobCache = {};
    return globalAny.jobCache;
};

const getYtDlpPath = () => {
    if (process.platform === 'darwin') {
        const potentialPaths = [
            '/opt/homebrew/bin/yt-dlp',
            '/usr/local/bin/yt-dlp',
            '/Users/gohteeyee/.nix-profile/bin/yt-dlp'
        ];
        for (const p of potentialPaths) {
            if (fs.existsSync(p)) return p;
        }
    }
    return 'yt-dlp';
};

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { url, quality, formatId, start, end, title } = body;
        const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

        if (!url) {
            return NextResponse.json({ error: 'URL is required' }, { status: 400 });
        }

        const logStore = getLogStore();
        const jobCache = getJobCache();

        logStore[jobId] = [`[${new Date().toLocaleTimeString()}] System: Job initialized.`];
        jobCache[jobId] = { status: 'processing', progress: 0 };

        // Start processing in the background (fire and forget)
        (async () => {
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-dl-'));
            const outputPath = path.join(tempDir, 'video.%(ext)s');

            try {
                const binaryPath = getYtDlpPath();
                const ytdl = youtubedl.create(binaryPath);

                logStore[jobId].push(`[${new Date().toLocaleTimeString()}] Stage 1: Requesting formats...`);

                const options: any = {
                    format: formatId ? `${formatId}+bestaudio/best` : `bestvideo[height<=${quality}]+bestaudio/best[height<=${quality}]/best`,
                    output: outputPath,
                    noCheckCertificates: true,
                    noWarnings: true,
                    noPlaylist: true, // Avoid playlist downloads when URL contains list=
                    mergeOutputFormat: 'mp4',
                    ffmpegLocation: '/opt/homebrew/bin/ffmpeg',
                    concurrentFragments: 8,
                    postprocessorArgs: ['ffmpeg:-threads 8 -cpu-used 5'],
                    addHeader: [
                        'referer:youtube.com',
                        'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
                    ]
                };

                if (start || end) {
                    const startVal = start || '0';
                    const endVal = end || 'inf';
                    options.downloadSections = `*${startVal}-${endVal}`;
                    options.forceKeyframesAtCuts = true;
                    logStore[jobId].push(`[${new Date().toLocaleTimeString()}] Stage 2: Processing Trim (${startVal}s-${endVal}s)`);
                } else {
                    logStore[jobId].push(`[${new Date().toLocaleTimeString()}] Stage 2: Starting High-Speed Download...`);
                }

                // Execute generic download
                const subprocess = ytdl.exec(url, options);

                const handleOutput = (data: any) => {
                    const line = data.toString().trim();
                    if (line) {
                        // Capture useful lines for logs
                        if (line.includes('%') || line.includes('Merging') || line.includes('Destination') || line.includes('ffmpeg')) {
                            logStore[jobId].push(`[${new Date().toLocaleTimeString()}] ${line.substring(0, 100)}`);
                            
                            // Keep only the last 100 logs in memory to prevent memory leaks
                            if (logStore[jobId].length > 100) {
                                logStore[jobId] = logStore[jobId].slice(-100);
                            }

                            // Update progress in cache for UI
                            const match = line.match(/(\d+(\.\d+)?)%/);
                            if (match) {
                                const raw = parseFloat(match[1]);
                                const clamped = Math.min(Math.max(raw, 0), 99.9);
                                jobCache[jobId].progress = clamped;
                            }

                            // If we're merging, set progress to 99%
                            if (line.toLowerCase().includes('merging')) {
                                jobCache[jobId].progress = 99;
                            }
                        }
                    }
                };

                subprocess.stdout?.on('data', handleOutput);
                subprocess.stderr?.on('data', handleOutput);

                await subprocess;

                // Mark progress as 100% when subprocess is done
                jobCache[jobId].progress = 100;

                // Find the result file
                const files = fs.readdirSync(tempDir);
                const videoFile = files.find(f => f.startsWith('video.'));

                if (!videoFile) throw new Error('No file created');

                const finalPath = path.join(tempDir, videoFile);
                const stats = fs.statSync(finalPath);

                logStore[jobId].push(`[${new Date().toLocaleTimeString()}] Success! Size: ${(stats.size / 1024 / 1024).toFixed(2)}MB`);
                logStore[jobId].push(`[${new Date().toLocaleTimeString()}] Ready for browser download.`);

                jobCache[jobId] = {
                    status: 'ready',
                    filePath: finalPath,
                    tempDir: tempDir,
                    filename: `${title || 'video'}.mp4`,
                    size: stats.size
                };

            } catch (err: any) {
                console.error(err);
                logStore[jobId].push(`[${new Date().toLocaleTimeString()}] ERROR: ${err.message}`);
                jobCache[jobId] = { status: 'error', error: err.message };

                // Cleanup on error
                if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
            }
        })();

        return NextResponse.json({ jobId, message: 'Download started' });

    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
