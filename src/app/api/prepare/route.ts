
import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import {
    downloadDouyinNoCookie,
    downloadDouyinStream,
    extractDouyinNoCookie,
    isDouyinUrl,
    pickBestDouyinFormat,
    resolveDouyinUrl,
} from '@/lib/douyin';
import { resolveAudioBitrate, resolveVideoQuality } from '@/lib/quality';
import { buildProxyDownloadUrl, refererForUrl } from '@/lib/download-client';
import { canUseLocalBinaries, devLog, isVercel } from '@/lib/env';
import { createYtDlp, getYtDlpPath } from '@/lib/ytdlp';
import { getFfmpegPath } from '@/lib/ffmpeg';
import { formatResolutionLabel, pickBestMuxedFormat, parseHeight } from '@/lib/formats';

export const runtime = 'nodejs';
export const maxDuration = 60;

const needsServerProcessing = (body: {
    enableTranslate?: boolean;
    removeWatermark?: boolean;
    start?: number | string;
    end?: number | string;
    manualAreas?: unknown[];
}): boolean =>
    Boolean(
        body.enableTranslate ||
            body.removeWatermark ||
            body.start ||
            body.end ||
            (Array.isArray(body.manualAreas) && body.manualAreas.length > 0)
    );

const canProxyStream = (
    streamUrl: string | undefined,
    isAudio: boolean,
    formatExt?: string,
    needsAudioMerge?: boolean
): boolean => {
    if (!streamUrl || streamUrl.includes('playwm')) return false;
    if (needsAudioMerge) return false;
    if (!isAudio) return true;
    const ext = (formatExt || '').toLowerCase();
    return (
        ext === 'mp3' ||
        ext === 'm4a' ||
        streamUrl.includes('.mp3') ||
        streamUrl.includes('mime_type=audio')
    );
};

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

// Legacy fallback: capture web player CDN stream (may include watermark)
const downloadDouyinDirect = async (url: string, outputPath: string, log: (msg: string) => void): Promise<boolean> => {
    log('[Direct] Attempting direct Douyin download via network interception...');
    const puppeteer = await import('puppeteer');

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required']
    });

    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1');

        // Set mobile viewport to trigger mobile version (often has less protection)
        await page.setViewport({ width: 375, height: 812, isMobile: true });

        // Collect video URLs from network requests
        const videoUrls: { url: string; size: number }[] = [];

        page.on('response', async (response) => {
            const reqUrl = response.url();
            const contentType = response.headers()['content-type'] || '';
            const contentLength = parseInt(response.headers()['content-length'] || '0', 10);

            // Skip images explicitly
            if (contentType.includes('image') || reqUrl.includes('.png') || reqUrl.includes('.jpg') || reqUrl.includes('.webp')) {
                return;
            }

            // Look for video content - Douyin uses specific CDN patterns
            const isVideoContent = contentType.includes('video') || contentType.includes('octet-stream');
            const isDouyinVideoUrl =
                (reqUrl.includes('playwm') && reqUrl.includes('video_id')) ||  // Watermark version
                (reqUrl.includes('play') && reqUrl.includes('video_id') && !reqUrl.includes('playwm')) ||  // No watermark
                reqUrl.includes('.mp4') ||
                (reqUrl.includes('douyinvod') && contentLength > 100000) ||
                (reqUrl.includes('bytedance') && reqUrl.includes('video') && contentLength > 100000);

            if (isVideoContent || isDouyinVideoUrl) {
                // Prefer URLs with video_id parameter and no watermark
                const priority = reqUrl.includes('video_id') && !reqUrl.includes('playwm') ? 1000000000 : contentLength;
                log(`[Direct] Found potential video: ${reqUrl.substring(0, 80)}... (${contentLength} bytes, priority: ${priority})`);
                videoUrls.push({ url: reqUrl, size: priority });
            }
        });

        log(`[Direct] Navigating to ${url}...`);

        try {
            // Use domcontentloaded for faster initial load, then wait for video or timeout
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        } catch (e: any) {
            log(`[Direct] Navigation warning: ${e.message}`);
        }

        // Poll for video URLs (max 15 seconds)
        let attempts = 0;
        while (videoUrls.length === 0 && attempts < 30) {
            await new Promise(r => setTimeout(r, 500)); // Check every 500ms
            attempts++;
        }

        // Wait a bit more for other qualities/streams to appear if we found one
        if (videoUrls.length > 0) {
            await new Promise(r => setTimeout(r, 2000));
        } else {
            log('[Direct] No video detected yet, trying interaction...');
        }

        // Try to click play button if video hasn't started
        try {
            await page.evaluate(() => {
                const playBtn = document.querySelector('[class*="play"], [class*="Play"], video');
                if (playBtn && 'click' in playBtn) {
                    (playBtn as HTMLElement).click();
                }
            });
            await new Promise(r => setTimeout(r, 2000));
        } catch { }

        await browser.close();

        if (videoUrls.length === 0) {
            throw new Error('No video URLs found via network interception');
        }

        // Sort by size and pick the largest (best quality)
        videoUrls.sort((a, b) => b.size - a.size);
        const bestVideo = videoUrls[0];

        log(`[Direct] Captured ${videoUrls.length} video streams. Downloading best quality...`);

        // Download with fetch + write to file
        const response = await fetch(bestVideo.url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
                'Referer': 'https://www.douyin.com/'
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to download video: ${response.status}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        fs.writeFileSync(outputPath, Buffer.from(arrayBuffer));
        log(`[Direct] Successfully downloaded video to ${outputPath} (${(arrayBuffer.byteLength / 1024 / 1024).toFixed(2)} MB)`);
        return true;

    } catch (err) {
        await browser.close();
        throw err;
    }
};

// Puppeteer strategy: Get fresh cookies instead of parsing DOM
const getFreshDouyinCookies = async (url: string, log: (msg: string) => void) => {
    log('[Puppeteer] Launching browser to fetch fresh cookies...');
    const puppeteer = (await import('puppeteer-extra')).default;
    const StealthPlugin = (await import('puppeteer-extra-plugin-stealth')).default;
    puppeteer.use(StealthPlugin());

    const browser = await puppeteer.launch({
        headless: true, // headless: "new" is default now
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        // Use a standard Desktop UA to ensure we get the desktop version of the site
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        await page.setRequestInterception(true);
        page.on('request', (req) => {
            // Block heavy assets to speed up
            if (['image', 'font', 'stylesheet', 'media'].includes(req.resourceType())) {
                req.abort();
            } else {
                req.continue();
            }
        });

        log(`[Puppeteer] Navigating to ${url}...`);
        // Navigate and wait for some inactivity to ensure cookies are set
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // Slight delay to allow any client-side cookie generation scripts to run
        await new Promise(r => setTimeout(r, 3000));

        const cookies = await page.cookies();
        log(`[Puppeteer] Extracted ${cookies.length} cookies.`);

        // Convert to Netscape format for yt-dlp
        // Format: domain flag path secure expiration name value
        const cookieString = cookies.map(c => {
            const domainFlag = c.domain.startsWith('.') ? 'TRUE' : 'FALSE';
            const expires = c.expires === -1 || c.expires === 0 ? Math.floor(Date.now() / 1000) + 31536000 : Math.floor(c.expires);
            return `${c.domain}\t${domainFlag}\t${c.path}\t${c.secure.toString().toUpperCase()}\t${expires}\t${c.name}\t${c.value}`;
        }).join('\n');

        return '# Netscape HTTP Cookie File\n' + cookieString;

    } catch (e: any) {
        log(`[Puppeteer] Cookie extraction failed: ${e.message}`);
        throw e;
    } finally {
        await browser.close();
    }
};

export async function POST(req: Request) {
    try {
        const body = await req.json();
        let { jobId: clientJobId, url, quality, formatId, start, end, title, removeWatermark, manualAreas, isBilibili, enableTranslate, cookiesText, streamUrl, mediaType, preferredHeight, preferredBitrate, formats: clientFormats, formatExt, needsAudioMerge } = body;
        const isAudio = mediaType === 'audio';

        let qualityNotice: string | null = null;
        let resolvedFormatExt = formatExt as string | undefined;
        let resolvedNeedsMerge = Boolean(needsAudioMerge);
        if (Array.isArray(clientFormats) && clientFormats.length > 0) {
            if (isAudio && preferredBitrate !== undefined) {
                const resolved = resolveAudioBitrate(preferredBitrate, clientFormats);
                qualityNotice = resolved.notice;
                quality = resolved.actual;
                formatId = resolved.format?.format_id;
                if (!streamUrl) streamUrl = resolved.format?.url;
                resolvedFormatExt = resolved.format?.ext;
                resolvedNeedsMerge = false;
            } else if (!isAudio && preferredHeight !== undefined) {
                const resolved = resolveVideoQuality(preferredHeight, clientFormats);
                qualityNotice = resolved.notice;
                quality = resolved.actual;
                formatId = resolved.format?.format_id;
                streamUrl = resolved.format?.url;
                resolvedFormatExt = resolved.format?.ext;
                resolvedNeedsMerge = resolved.needsAudioMerge;
            }
        }
        devLog('[prepare] streamUrl:', streamUrl ? `${streamUrl.substring(0, 80)}...` : 'none');
        
        // Use client-provided jobId if available to match frontend state
        const jobId = clientJobId || `job_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

        if (!url) {
            return NextResponse.json({ error: 'URL is required' }, { status: 400 });
        }

        const logStore = getLogStore();
        const jobCache = getJobCache();

        logStore[jobId] = [`[${new Date().toLocaleTimeString()}] System: Job initialized.`];
        jobCache[jobId] = { status: 'processing', progress: 0, qualityNotice };
        if (qualityNotice) {
            logStore[jobId].push(`[Notice] ${qualityNotice}`);
        }

        const serverProcessing = needsServerProcessing({
            enableTranslate,
            removeWatermark,
            start,
            end,
            manualAreas,
        });

        if (streamUrl?.includes('playwm') && isDouyinUrl(url)) {
            try {
                const metadata = await extractDouyinNoCookie(url);
                const picked = pickBestDouyinFormat(metadata.formats);
                if (picked?.url && !picked.url.includes('playwm')) {
                    streamUrl = picked.url;
                }
            } catch {
                // fall through
            }
        }

        if (
            resolvedNeedsMerge &&
            isVercel() &&
            Array.isArray(clientFormats) &&
            clientFormats.length > 0
        ) {
            const muxed = pickBestMuxedFormat(clientFormats, Number(quality) || undefined);
            if (muxed?.url) {
                streamUrl = muxed.url;
                formatId = muxed.format_id;
                resolvedFormatExt = muxed.ext;
                resolvedNeedsMerge = false;
                const muxedHeight = parseHeight(muxed);
                const muxedLabel = muxedHeight ? formatResolutionLabel(muxedHeight) : 'available quality';
                qualityNotice =
                    qualityNotice ||
                    `Downloaded with audio at ${muxedLabel}. Cloud servers use a single-stream MP4 for compatibility.`;
                if (jobCache[jobId]) {
                    jobCache[jobId].qualityNotice = qualityNotice;
                }
                logStore[jobId].push(
                    `[${new Date().toLocaleTimeString()}] Using muxed stream for cloud download (${muxedLabel}).`
                );
            }
        }

        if (!serverProcessing && canProxyStream(streamUrl, isAudio, resolvedFormatExt, resolvedNeedsMerge)) {
            const outExt = isAudio ? 'mp3' : 'mp4';
            const safeTitle =
                (title || (isAudio ? 'audio' : 'video')).replace(/[<>:"/\\|?*]/g, '').trim() ||
                (isAudio ? 'audio' : 'video');
            const filename = `${safeTitle}.${outExt}`;
            const referer = refererForUrl(url);
            const downloadUrl = buildProxyDownloadUrl(streamUrl!, filename, referer);

            logStore[jobId].push(
                `[${new Date().toLocaleTimeString()}] Ready for browser download (direct stream).`
            );
            jobCache[jobId] = {
                status: 'ready',
                progress: 100,
                downloadUrl,
                filename,
                qualityNotice,
                direct: true,
            };

            return NextResponse.json({ jobId, direct: true, downloadUrl, qualityNotice });
        }

        if (isVercel() && !canUseLocalBinaries() && !resolvedNeedsMerge) {
            if (isDouyinUrl(url)) {
                try {
                    const metadata = await extractDouyinNoCookie(url);
                    const picked = pickBestDouyinFormat(metadata.formats);
                    if (picked?.url && !picked.url.includes('playwm') && !serverProcessing) {
                        const outExt = isAudio ? 'mp3' : 'mp4';
                        const safeTitle =
                            (title || (isAudio ? 'audio' : 'video')).replace(/[<>:"/\\|?*]/g, '').trim() ||
                            (isAudio ? 'audio' : 'video');
                        const filename = `${safeTitle}.${outExt}`;
                        const referer = refererForUrl(url);
                        const downloadUrl = buildProxyDownloadUrl(picked.url, filename, referer);

                        logStore[jobId].push(
                            `[${new Date().toLocaleTimeString()}] Ready for browser download (Douyin API).`
                        );
                        jobCache[jobId] = {
                            status: 'ready',
                            progress: 100,
                            downloadUrl,
                            filename,
                            qualityNotice,
                            direct: true,
                        };

                        return NextResponse.json({ jobId, direct: true, downloadUrl, qualityNotice });
                    }
                } catch {
                    // fall through to error below
                }
            }

            logStore[jobId].push(
                `[${new Date().toLocaleTimeString()}] ERROR: Direct download unavailable in cloud environment.`
            );
            jobCache[jobId] = {
                status: 'error',
                error: resolvedNeedsMerge
                    ? 'This quality requires merging video and audio, which is not supported on cloud hosting. Try a lower quality.'
                    : serverProcessing
                    ? 'Translation, trim, and watermark removal require local processing and are not available in production.'
                    : 'No direct download URL available for this video. Try a different quality or provide platform cookies.',
            };
            return NextResponse.json(
                { error: jobCache[jobId].error },
                { status: serverProcessing || resolvedNeedsMerge ? 503 : 422 }
            );
        }

        // Start processing in the background (fire and forget)
        (async () => {
            const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-dl-'));
            const outputPath = path.join(tempDir, isAudio ? 'audio.%(ext)s' : 'video.%(ext)s');

            try {
                const ytdl = createYtDlp();

                logStore[jobId].push(`[${new Date().toLocaleTimeString()}] Stage 1: Requesting formats...`);

                const activeUrl = isDouyinUrl(url) ? await resolveDouyinUrl(url) : url;
                if (activeUrl !== url) {
                    logStore[jobId].push(`[${new Date().toLocaleTimeString()}] Resolved short link.`);
                }

                // Determine referer based on URL
                let referer = 'https://www.youtube.com/';
                if (activeUrl.includes('bilibili.com') || activeUrl.includes('b23.tv')) {
                    referer = 'https://www.bilibili.com/';
                    isBilibili = true;
                } else if (activeUrl.includes('tiktok.com')) {
                    referer = 'https://www.tiktok.com/';
                } else if (activeUrl.includes('douyin.com')) {
                    referer = 'https://www.douyin.com/';
                }

                const desktopHeaders = [
                    `referer:${referer}`,
                    'user-agent:Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
                    'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                    'Accept-Language: zh-CN,zh;q=0.9,en;q=0.8',
                ];

                const isAudio = mediaType === 'audio';

                const convertToMp3 = (inputPath: string, outputPath: string, targetKbps?: number) =>
                    new Promise<void>((resolve, reject) => {
                        const args = ['-i', inputPath, '-vn', '-acodec', 'libmp3lame'];
                        if (targetKbps && targetKbps > 0) {
                            args.push('-b:a', `${targetKbps}k`);
                        } else {
                            args.push('-q:a', '2');
                        }
                        args.push('-y', outputPath);
                        const proc = spawn('/opt/homebrew/bin/ffmpeg', args);
                        proc.stderr?.on('data', () => {});
                        proc.on('close', (code) =>
                            code === 0 ? resolve() : reject(new Error(`MP3 conversion failed (code ${code})`))
                        );
                    });

                const options: any = {
                    output: outputPath,
                    noCheckCertificates: true,
                    noWarnings: true,
                    noPlaylist: true,
                    concurrentFragments: 8,
                    extractorArgs: {
                        'tiktok': ['no-watermark'],
                        'bilibili': ['no-watermark'],
                        'douyin': ['no-watermark']
                    }
                };

                const ffmpegPath = getFfmpegPath();
                if (ffmpegPath) {
                    options.ffmpegLocation = ffmpegPath;
                    options.postprocessorArgs = ['ffmpeg:-threads 4'];
                }

                if (isAudio) {
                    options.format = formatId && formatId !== 'bestaudio' ? formatId : 'bestaudio/best';
                    options.extractAudio = true;
                    options.audioFormat = 'mp3';
                    if (quality && quality > 0) {
                        options.postprocessorArgs = [`ffmpeg:-b:a ${quality}k`];
                    }
                } else {
                    options.format = formatId
                        ? `${formatId}+bestaudio/best`
                        : `bestvideo[height<=${quality}]+bestaudio/best[height<=${quality}]/best`;
                    options.mergeOutputFormat = 'mp4';
                }

                let cookiesFilePath: string | null = null;
                if (cookiesText && typeof cookiesText === 'string' && cookiesText.trim().length > 0) {
                    if (cookiesText.startsWith('# Netscape') || cookiesText.includes('\t')) {
                        cookiesFilePath = path.join(tempDir, 'cookies.txt');
                        fs.writeFileSync(cookiesFilePath, cookiesText.trim());
                        options.cookies = cookiesFilePath;
                    } else {
                        if (!options.addHeader) options.addHeader = [];
                        options.addHeader.push(`Cookie:${cookiesText.trim()}`);
                    }
                }

                if (start || end) {
                    const startVal = start || '0';
                    const endVal = end || 'inf';
                    options.downloadSections = `*${startVal}-${endVal}`;
                    options.forceKeyframesAtCuts = true;
                    logStore[jobId].push(`[${new Date().toLocaleTimeString()}] Stage 2: Processing Trim (${startVal}s-${endVal}s)`);
                } else {
                    logStore[jobId].push(`[${new Date().toLocaleTimeString()}] Stage 2: Starting High-Speed Download...`);
                }

                // Helper to handle and parse yt-dlp output
                const handleOutput = (data: any) => {
                    const message = data.toString();
                    const match = message.match(/(\d+\.\d+)%/);
                    if (match) {
                        const p = parseFloat(match[1]);
                        if (!isNaN(p)) {
                            jobCache[jobId].progress = p;
                        }
                    }
                    console.log(`[yt-dlp] ${message.trim()}`);
                    // Forward yt-dlp logs to UI
                    logStore[jobId].push(`[yt-dlp] ${message.substring(0, 50)}`);
                };

                const runDownload = async () => {
                    if (isDouyinUrl(activeUrl)) {
                        let douyinStreamUrl = streamUrl;
                        if (!douyinStreamUrl || douyinStreamUrl.includes('playwm')) {
                            try {
                                const metadata = await extractDouyinNoCookie(activeUrl);
                                douyinStreamUrl = pickBestDouyinFormat(metadata.formats)?.url;
                            } catch {
                                // fall through to other strategies
                            }
                        }

                        if (douyinStreamUrl && !douyinStreamUrl.includes('playwm')) {
                            try {
                                logStore[jobId].push(`[${new Date().toLocaleTimeString()}] ⚡ Downloading no-watermark stream...`);
                                const directPath = path.join(tempDir, 'video.mp4');
                                await downloadDouyinStream(douyinStreamUrl, directPath, (msg) => logStore[jobId].push(msg));
                                logStore[jobId].push(`[${new Date().toLocaleTimeString()}] Download complete!`);
                                return;
                            } catch (e: any) {
                                logStore[jobId].push(`[Douyin API] Stream download failed: ${e.message}, retrying...`);
                            }
                        }

                        try {
                            logStore[jobId].push(`[${new Date().toLocaleTimeString()}] Douyin API: Fetching no-watermark stream...`);
                            const directPath = path.join(tempDir, 'video.mp4');
                            await downloadDouyinNoCookie(activeUrl, directPath, (msg) => logStore[jobId].push(msg));
                            logStore[jobId].push(`[${new Date().toLocaleTimeString()}] Douyin API download successful!`);
                            return;
                        } catch (apiErr: any) {
                            console.error('Douyin API download failed:', apiErr.message);
                            logStore[jobId].push(`[Douyin API] Failed: ${apiErr.message}, falling back to legacy capture...`);
                        }

                        try {
                            logStore[jobId].push(`[${new Date().toLocaleTimeString()}] Legacy: Attempting web player capture...`);
                            const directPath = path.join(tempDir, 'video.mp4');
                            await downloadDouyinDirect(activeUrl, directPath, (msg) => logStore[jobId].push(msg));
                            logStore[jobId].push(`[${new Date().toLocaleTimeString()}] Legacy capture successful!`);
                            return;
                        } catch (dErr: any) {
                            console.error('Legacy capture failed:', dErr.message);
                            logStore[jobId].push(`[Direct] Legacy capture failed: ${dErr.message}, falling back to yt-dlp...`);
                        }
                    }

                    let lastErr: any;

                    try {
                        console.log('Starting Desktop yt-dlp download for:', activeUrl);
                        if (isDouyinUrl(activeUrl)) {
                            options.addHeader = desktopHeaders;
                        }

                        const sub = ytdl.exec(activeUrl, options);
                        sub.stdout?.on('data', handleOutput);
                        sub.stderr?.on('data', handleOutput);
                        await sub;
                        return true;
                    } catch (e: any) {
                        console.log('Desktop download failed:', e.message);
                        lastErr = e;

                        // Priority Fallback for Douyin: Try Direct Download immediately
                        // This avoids waiting for multiple yt-dlp timeouts since we know Direct is most reliable for Douyin
                        if (isDouyinUrl(activeUrl)) {
                            try {
                                logStore[jobId].push(`[${new Date().toLocaleTimeString()}] Optimizing: Attempting Direct Download Strategy...`);
                                const directPath = path.join(tempDir, 'video.mp4');
                                await downloadDouyinDirect(activeUrl, directPath, (msg) => logStore[jobId].push(msg));
                                logStore[jobId].push(`[${new Date().toLocaleTimeString()}] Direct download successful!`);
                                return true;
                            } catch (directErr: any) {
                                console.error('Direct priority failed:', directErr.message);
                                logStore[jobId].push(`[Direct] Strategy failed: ${directErr.message}, trying legacy methods...`);
                            }
                        }

                        // 1.5 Try Mobile User-Agent with Provided Cookies (if exist)
                        if (activeUrl.includes('douyin.com') && options.cookies) {
                            try {
                                console.log('Attempting Mobile User-Agent strategy with provided cookies...');
                                logStore[jobId].push(`[${new Date().toLocaleTimeString()}] Stage 2: Retrying with Mobile UA...`);

                                const mobileOptions = { ...options };
                                mobileOptions.addHeader = [
                                    'user-agent:Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
                                    'referer:https://www.douyin.com/'
                                ];

                                const sub = ytdl.exec(activeUrl, mobileOptions);
                                sub.stdout?.on('data', handleOutput);
                                sub.stderr?.on('data', handleOutput);
                                await sub;
                                return true;
                            } catch (mobileCookieErr: any) {
                                console.log('Mobile + Cookies failed:', mobileCookieErr.message);
                            }
                        }

                        // 2. Try Mobile User-Agent Strategy (No cookies / Auto cookies)
                        if (isDouyinUrl(activeUrl)) {
                            try {
                                console.log('Attempting Mobile User-Agent strategy...');
                                logStore[jobId].push(`[${new Date().toLocaleTimeString()}] Stage 2: Attempting mobile strategy...`);

                                const mobileOptions = { ...options };
                                mobileOptions.addHeader = [
                                    'user-agent:Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
                                    'referer:https://www.douyin.com/'
                                ];

                                const sub = ytdl.exec(activeUrl, mobileOptions);
                                sub.stdout?.on('data', handleOutput);
                                sub.stderr?.on('data', handleOutput);
                                await sub;
                                return true;
                            } catch (mobileErr: any) {
                                console.log('Mobile strategy failed:', mobileErr.message);

                                // 3. Fallback: Puppeteer Cookies + Retry
                                try {
                                    logStore[jobId].push(`[${new Date().toLocaleTimeString()}] Fallback: Fetching fresh cookies via Puppeteer...`);
                                    const cookieContent = await getFreshDouyinCookies(activeUrl, (msg) => logStore[jobId].push(msg));

                                    const freshCookiesPath = path.join(tempDir, 'puppeteer_cookies.txt');
                                    fs.writeFileSync(freshCookiesPath, cookieContent);
                                    cookiesFilePath = freshCookiesPath;

                                    // Retry standard desktop download but with FRESH cookies
                                    const retryOptions = { ...options };
                                    retryOptions.cookies = freshCookiesPath;
                                    retryOptions.addHeader = desktopHeaders; // Ensure desktop UA matches cookies

                                    logStore[jobId].push(`[${new Date().toLocaleTimeString()}] Retrying with fresh cookies...`);
                                    const sub = ytdl.exec(activeUrl, retryOptions);
                                    sub.stdout?.on('data', handleOutput);
                                    sub.stderr?.on('data', handleOutput);
                                    await sub;
                                    return true;
                                } catch (pe: any) {
                                    console.error('Puppeteer fallback failed:', pe);
                                    logStore[jobId].push(`[Error] Puppeteer fallback failed: ${pe.message}`);

                                    // 4. FINAL FALLBACK: Direct page parsing (bypass yt-dlp entirely)
                                    try {
                                        logStore[jobId].push(`[${new Date().toLocaleTimeString()}] Final Strategy: Direct download...`);
                                        const directPath = path.join(tempDir, 'video.mp4');
                                        await downloadDouyinDirect(activeUrl, directPath, (msg) => logStore[jobId].push(msg));
                                        logStore[jobId].push(`[${new Date().toLocaleTimeString()}] Direct download successful!`);
                                        return true;
                                    } catch (directErr: any) {
                                        console.error('Direct download also failed:', directErr.message);
                                        logStore[jobId].push(`[Error] Direct download failed: ${directErr.message}`);
                                    }
                                }
                            }
                        }

                        // If everything failed, throw original error
                        throw lastErr;
                    }
                };

                await runDownload();

                // Find the result file
                const files = fs.readdirSync(tempDir);
                const resultFile = isAudio
                    ? files.find((f) => f.endsWith('.mp3'))
                        || files.find((f) => f.startsWith('audio.'))
                        || files.find((f) => f.startsWith('video.'))
                    : files.find((f) => f.startsWith('video.')) || files.find((f) => f.endsWith('.mp4'));
                if (!resultFile) throw new Error('No file created');
                const rawPath = path.join(tempDir, resultFile);

                let finalPath = rawPath;
                if (!isAudio && (removeWatermark || enableTranslate)) {
                    jobCache[jobId].progress = 91;
                    logStore[jobId].push(`[${new Date().toLocaleTimeString()}] Stage 3: Initializing Luxe Engine...`);
                    console.log(`[API] [${jobId}] Starting post-processing (Luxe Engine)`);

                    const cleanedFile = path.join(tempDir, `cleaned_${Date.now()}.mp4`);

                    const ffprobeCmd = `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "${rawPath}"`;

                    try {
                        const dimensions = require('child_process').execSync(ffprobeCmd).toString().trim();
                        const [width, height] = dimensions.split('x').map(Number);
                        let videoFilters = [];

                        if (removeWatermark) {
                            if (manualAreas && manualAreas.length > 0) {
                                logStore[jobId].push(`[${new Date().toLocaleTimeString()}] Luxe Clean: Applying ${manualAreas.length} custom erase areas...`);
                                manualAreas.forEach((area: any) => {
                                    const x = Math.max(0, Math.round((area.x / 100) * width));
                                    const y = Math.max(0, Math.round((area.y / 100) * height));
                                    const w = Math.max(1, Math.round((area.w / 100) * width));
                                    const h = Math.max(1, Math.round((area.h / 100) * height));
                                    videoFilters.push(`delogo=x=${x}:y=${y}:w=${w}:h=${h}`);
                                });
                            } else if (isBilibili) {
                                logStore[jobId].push(`[${new Date().toLocaleTimeString()}] Luxe Clean: Applying auto-watermark removal...`);
                                const w = Math.round(width * 0.25);
                                const h = Math.round(height * 0.12);
                                videoFilters.push(`delogo=x=20:y=20:w=${w}:h=${h},delogo=x=${width - w - 20}:y=20:w=${w}:h=${h}`);
                            }
                        }

                        // B. AI Translation Overlay
                        if (enableTranslate) {
                            logStore[jobId].push(`[${new Date().toLocaleTimeString()}] Luxe AI: Scanning for available transcripts...`);
                            try {
                                const subPath = path.join(tempDir, 'sub');
                                const cookieArg = cookiesFilePath ? ` --cookies "${cookiesFilePath}"` : '';
                                // Use execSync with small buffer and timeout
                                require('child_process').execSync(`"${getYtDlpPath()}"${cookieArg} --write-subs --write-auto-subs --all-subs --skip-download --convert-subs srt -o "${subPath}" "${url}"`, { stdio: 'ignore', timeout: 30000 });

                                const files = fs.readdirSync(tempDir);
                                console.log(`[API] [${jobId}] Found subtitle files:`, files.filter(f => f.endsWith('.srt')));

                                // Priority: en-US > en > zh-Hans (translated) > any srt
                                let srtFile = files.find(f => f.includes('.en') && f.endsWith('.srt')) ||
                                    files.find(f => f.includes('.zh-Hans') && f.endsWith('.srt')) ||
                                    files.find(f => f.endsWith('.srt'));

                                if (srtFile) {
                                    let fullSrtPath = path.join(tempDir, srtFile);
                                    logStore[jobId].push(`[${new Date().toLocaleTimeString()}] Luxe AI: Synced ${srtFile} track.`);

                                    let escapedPath = fullSrtPath.replace(/\\/g, '/');
                                    escapedPath = escapedPath.replace(/'/g, "'\\\\\\''");
                                    escapedPath = escapedPath.replace(/:/g, '\\:');

                                    videoFilters.push(`subtitles='${escapedPath}':force_style='Alignment=2,Outline=0,Shadow=0,FontSize=22,PrimaryColour=&H00FFFF,BackColour=&HFF000000,BorderStyle=3,MarginV=20'`);
                                    logStore[jobId].push(`[${new Date().toLocaleTimeString()}] Luxe AI: Subtitle layer active.`);
                                } else {
                                    // --- LUXE AI: AUTOTRANSCRIBE 7.0 ---
                                    logStore[jobId].push(`[${new Date().toLocaleTimeString()}] Luxe AI: No subtitles found. Launching AI Transcription...`);
                                    try {
                                        const audioPath = path.join(tempDir, 'audio.wav');
                                        logStore[jobId].push(`[${new Date().toLocaleTimeString()}] Luxe AI: Extracting audio for AI analysis...`);
                                        require('child_process').execSync(`ffmpeg -i "${rawPath}" -ar 16000 -ac 1 -c:a pcm_s16le "${audioPath}" -y`, { timeout: 60000 });

                                        logStore[jobId].push(`[${new Date().toLocaleTimeString()}] Luxe AI: AI is "listening" to the video (may take 1 min)...`);
                                        const { whisper } = require('whisper-node');
                                        await whisper(audioPath, {
                                            modelName: "base.en",
                                            whisperOptions: {
                                                language: 'auto',
                                                gen_file_srt: true,
                                                task: 'translate' // Translate to English
                                            }
                                        });

                                        const generatedSrt = audioPath.replace('.wav', '.srt');
                                        const altGeneratedSrt = audioPath + '.srt';
                                        const finalSrt = fs.existsSync(generatedSrt) ? generatedSrt : (fs.existsSync(altGeneratedSrt) ? altGeneratedSrt : null);

                                        if (finalSrt) {
                                            const escapedPath = finalSrt.replace(/\\/g, '/').replace(/'/g, "'\\\\\\''").replace(/:/g, '\\:');
                                            videoFilters.push(`subtitles='${escapedPath}':force_style='Alignment=2,Outline=0,Shadow=0,FontSize=22,PrimaryColour=&H00FFFF,BackColour=&HFF000000,BorderStyle=3,MarginV=20'`);
                                            logStore[jobId].push(`[${new Date().toLocaleTimeString()}] Luxe AI: AI transcription successful.`);
                                        } else {
                                            logStore[jobId].push(`[${new Date().toLocaleTimeString()}] Luxe AI: AI transcription failed to generate file.`);
                                        }
                                    } catch (transError: any) {
                                        logStore[jobId].push(`[${new Date().toLocaleTimeString()}] Luxe AI: AI Engine busy or unavailable.`);
                                    }
                                }
                            } catch (e) {
                                logStore[jobId].push(`[${new Date().toLocaleTimeString()}] Luxe AI: Transcript engine offline.`);
                            }
                        }

                        if (videoFilters.length > 0) {
                            logStore[jobId].push(`[${new Date().toLocaleTimeString()}] Stage 3: Rendering high-fidelity output...`);
                            const ffmpegArgs = [
                                '-i', rawPath,
                                '-vf', videoFilters.join(','),
                                '-c:v', 'h264_videotoolbox',
                                '-b:v', '5000k',
                                '-c:a', 'copy',
                                '-y',
                                cleanedFile
                            ];
                            // Execute ffmpeg with proper stream handling
                            await new Promise((resolve, reject) => {
                                const proc = spawn('ffmpeg', ffmpegArgs);
                                // Consume output to prevent buffer blocking
                                proc.stdout?.on('data', () => { });
                                proc.stderr?.on('data', (data) => {
                                    const msg = data.toString();
                                    const timeMatch = msg.match(/time=(\d+:\d+:\d+\.\d+)/);
                                    if (timeMatch) {
                                        // Update progress during encoding (approximate)
                                        jobCache[jobId].progress = 95;
                                    }
                                });
                                proc.on('close', (code) => code === 0 ? resolve(true) : reject(new Error(`FFmpeg failed with code ${code}`)));
                            });
                            finalPath = cleanedFile;
                            if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath);
                        }
                    } catch (e: any) {
                        console.error('Post-processing error', e);
                        logStore[jobId].push(`[${new Date().toLocaleTimeString()}] Warning: Luxe Engine post-processing bypassed (${e.message}).`);
                    }
                }

                if (isAudio && !finalPath.endsWith('.mp3')) {
                    jobCache[jobId].progress = 90;
                    logStore[jobId].push(`[${new Date().toLocaleTimeString()}] Converting to MP3...`);
                    const mp3Path = path.join(tempDir, 'output.mp3');
                    await convertToMp3(finalPath, mp3Path, quality);
                    if (finalPath !== mp3Path && fs.existsSync(finalPath)) {
                        fs.unlinkSync(finalPath);
                    }
                    finalPath = mp3Path;
                }

                const stats = fs.statSync(finalPath);
                const outExt = isAudio ? 'mp3' : 'mp4';
                const safeTitle = (title || (isAudio ? 'audio' : 'video')).replace(/[<>:"/\\|?*]/g, '').trim() || (isAudio ? 'audio' : 'video');
                logStore[jobId].push(`[${new Date().toLocaleTimeString()}] Success! Size: ${(stats.size / 1024 / 1024).toFixed(2)}MB`);
                logStore[jobId].push(`[${new Date().toLocaleTimeString()}] Ready for browser download.`);

                jobCache[jobId] = {
                    ...jobCache[jobId],
                    status: 'ready',
                    progress: 100,
                    filePath: finalPath,
                    tempDir: tempDir,
                    filename: `${safeTitle}.${outExt}`,
                    mimeType: isAudio ? 'audio/mpeg' : 'video/mp4',
                    qualityNotice,
                    size: stats.size
                };

            } catch (err: any) {
                console.error(err);
                logStore[jobId].push(`[${new Date().toLocaleTimeString()}] ERROR: ${err.message}`);
                jobCache[jobId] = { status: 'error', error: err.message };
                if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
            }
        })();

        return NextResponse.json({ jobId, message: 'Download started' });

    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
