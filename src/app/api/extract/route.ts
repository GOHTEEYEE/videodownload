
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
    extractDouyinNoCookie,
    isDouyinUrl,
    resolveDouyinUrl,
    sanitizeInputUrl,
} from '@/lib/douyin';
import { canUseBrowserAutomation, devLog, isVercel } from '@/lib/env';
import {
    applyCookiesToYtDlpOptions,
    cookiesMatchPlatform,
    detectCookiePlatform,
    diagnoseYouTubeCookies,
    hasServerCookies,
    resolveCookiesForRequest,
} from '@/lib/cookie-store';
import { isYouTubeUrl, normalizeYouTubeUrl } from '@/lib/download-client';
import { createYtDlp } from '@/lib/ytdlp';

export const runtime = 'nodejs';
export const maxDuration = 60;

const isTikTokUrl = (url: string) => /tiktok\.com/i.test(url);

// `null` = let yt-dlp pick its default clients.
// With cookies: prefer cookie-aware clients (mweb/web) — they bypass the
// datacenter bot check. Without cookies: prefer bot-resistant clients.
// `web`/`tv`/`ios` can fail with "Requested format is not available" on some
// videos, so they are not first in the no-cookie list.
const YOUTUBE_CLIENTS_WITH_COOKIES: Array<string | null> = [
    'mweb',
    'web',
    null,
    'android,web',
    'tv_embedded',
];
const YOUTUBE_CLIENTS_NO_COOKIES: Array<string | null> = [
    null,
    'mweb',
    'android,web',
    'tv_embedded',
    'ios',
];

const hasUsableFormats = (output: any): boolean =>
    Boolean(output && Array.isArray(output.formats) && output.formats.length > 0) ||
    Boolean(output && output.url);

const runYtDlpExtract = async (
    ytdl: ReturnType<typeof createYtDlp>,
    url: string,
    baseOptions: Record<string, unknown>,
    withCookies = false
) => {
    if (!isYouTubeUrl(url)) {
        return ytdl(url, baseOptions as any);
    }

    const strategies = withCookies
        ? YOUTUBE_CLIENTS_WITH_COOKIES
        : YOUTUBE_CLIENTS_NO_COOKIES;
    let lastError: unknown;
    for (const client of strategies) {
        try {
            const youtubeArgs = [
                ...(((baseOptions.extractorArgs as Record<string, string[]> | undefined)
                    ?.youtube as string[] | undefined) ?? []),
            ].filter((arg) => !arg.startsWith('player_client='));
            if (client) youtubeArgs.push(`player_client=${client}`);

            const options = {
                ...baseOptions,
                extractorArgs: {
                    ...(baseOptions.extractorArgs as Record<string, string[]> | undefined),
                    youtube: youtubeArgs,
                },
            };
            devLog(`[API] YouTube extract try player_client=${client ?? 'default'}`);
            const output = await ytdl(url, options as any);
            if (hasUsableFormats(output)) {
                return output;
            }
            devLog(`[API] player_client=${client ?? 'default'} returned no formats, trying next`);
        } catch (error) {
            lastError = error;
        }
    }

    if (lastError) throw lastError;
    throw new Error('Requested format is not available');
};

const mapExtractError = (errorMessage: string, requestUrl: string) => {
    const douyinHint = isDouyinUrl(requestUrl);
    const youtubeHint = isYouTubeUrl(requestUrl);
    const tiktokHint = isTikTokUrl(requestUrl);

    if (errorMessage.includes('not a valid URL') || errorMessage.includes('Unsupported URL')) {
        return { status: 400, error: 'Invalid or unsupported video URL.' };
    }
    if (errorMessage.includes('Private video') || errorMessage.includes('This video is private')) {
        return { status: 403, error: 'This video is private and cannot be downloaded.' };
    }
    if (errorMessage.includes('Video unavailable') || errorMessage.includes('has been removed')) {
        return { status: 404, error: 'This video is unavailable or has been removed.' };
    }
    if (errorMessage.includes('Requested format is not available')) {
        return {
            status: 422,
            error: youtubeHint
                ? 'YouTube returned no matching stream for this request. Try MP4 instead of MP3, pick Highest Available quality, or use a plain watch link (without playlist/radio).'
                : 'Requested quality or format is not available. Try a lower quality or a different format.',
        };
    }
    if (
        errorMessage.includes('status code 10231') ||
        errorMessage.includes('10231')
    ) {
        return {
            status: 503,
            error:
                'TikTok blocked the cloud server for this video. Open TikTok in your browser, export cookies, paste them under Advanced, then try again.',
        };
    }
    if (
        errorMessage.includes('IP address is blocked') ||
        errorMessage.includes('blocked from accessing')
    ) {
        return {
            status: 503,
            error: tiktokHint
                ? 'TikTok blocked the server IP. Try again later or use a different video.'
                : 'This platform blocked the server. Please try again later.',
        };
    }
    if (
        errorMessage.includes('Fresh cookies') ||
        errorMessage.includes('Sign in to confirm') ||
        errorMessage.includes('sign in') ||
        errorMessage.includes('Login required') ||
        errorMessage.includes('requires cookies') ||
        errorMessage.includes('browser cookies') ||
        errorMessage.includes('bot') ||
        errorMessage.includes('HTTP Error 429') ||
        errorMessage.includes('HTTP Error 403')
    ) {
        return {
            status: 429,
            error: douyinHint
                ? 'Douyin security check triggered. Try again later or provide browser cookies.'
                : youtubeHint
                  ? hasServerCookies('youtube')
                    ? 'YouTube rejected the server cookies (expired, incomplete, or IP mismatch with Vercel). Re-export while logged in at youtube.com, use COOKIES_YOUTUBE_BASE64 in Vercel, then redeploy. Some videos may still fail on cloud servers.'
                    : 'YouTube is blocking the cloud server. Configure server YouTube cookies (COOKIES_YOUTUBE) in Vercel, or wait and try another video.'
                  : 'This platform blocked automated access. Try again later.',
        };
    }

    return { status: 500, error: errorMessage };
};

// Direct Douyin extraction by intercepting network requests to find video URLs
const extractDouyinDirect = async (url: string): Promise<any> => {
    if (!canUseBrowserAutomation()) {
        throw new Error('Browser extraction is unavailable in this environment');
    }
    devLog('[Direct] Attempting direct Douyin extraction via network interception...');
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
        let pageTitle = 'Douyin Video';
        let thumbnail = '';

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
                // Prefer URLs with video_id parameter
                const priority = reqUrl.includes('video_id') && !reqUrl.includes('playwm') ? 1000000000 : contentLength;
                devLog(`[Direct] Found potential video: ${reqUrl.substring(0, 100)}... (${contentLength} bytes, priority: ${priority})`);
                videoUrls.push({ url: reqUrl, size: priority });
            }
        });

        devLog(`[Direct] Navigating to ${url}...`);
        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        } catch (e: any) {
            devLog(`[Direct] Navigation ended: ${e.message}`);
        }

        // Try to get page title and thumbnail
        try {
            pageTitle = await page.title() || 'Douyin Video';
            thumbnail = await page.evaluate(() => {
                const meta = document.querySelector('meta[property="og:image"]');
                return meta ? meta.getAttribute('content') || '' : '';
            });
        } catch { }

        // Poll for video URLs (max 15s)
        let attempts = 0;
        while (videoUrls.length === 0 && attempts < 30) {
            await new Promise(r => setTimeout(r, 500));
            attempts++;
        }

        if (videoUrls.length > 0) {
            await new Promise(r => setTimeout(r, 2000));
        } else {
            devLog('[Direct] No video detected yet, trying interaction...');
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

        devLog(`[Direct] Successfully captured video URL! Found ${videoUrls.length} video streams.`);

        // Extract video ID from URL
        const idMatch = url.match(/video\/(\d+)/);
        const videoId = idMatch ? idMatch[1] : 'unknown';

        return {
            id: videoId,
            title: pageTitle.replace(' - 抖音', '').trim() || 'Douyin Video',
            description: pageTitle,
            thumbnail: thumbnail,
            duration: 0,
            uploader: 'Douyin User',
            uploader_id: '',
            view_count: 0,
            like_count: 0,
            extractor: 'Douyin',
            extractor_key: 'Douyin',
            webpage_url: url,
            formats: videoUrls.map((v, i) => ({
                format_id: i === 0 ? 'best' : `format_${i}`,
                url: v.url,
                ext: 'mp4',
                filesize: v.size,
                height: i === 0 ? 1080 : 720,
                width: i === 0 ? 1920 : 1280,
                vcodec: 'h264',
                acodec: 'aac',
                format_note: i === 0 ? 'Best quality (network capture)' : 'Alternative quality'
            }))
        };
    } catch (err) {
        await browser.close();
        throw err;
    }
};

// Puppeteer strategy: Get fresh cookies instead of parsing DOM
const getFreshDouyinCookies = async (url: string) => {
    devLog('[Puppeteer] Launching browser to fetch fresh cookies...');
    const puppeteer = (await import('puppeteer-extra')).default;
    const StealthPlugin = (await import('puppeteer-extra-plugin-stealth')).default;
    puppeteer.use(StealthPlugin());

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (['image', 'font', 'stylesheet', 'media'].includes(req.resourceType())) {
                req.abort();
            } else {
                req.continue();
            }
        });

        devLog(`[Puppeteer] Navigating to ${url}...`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, 3000));

        const cookies = await page.cookies();

        // Convert to Netscape format
        return '# Netscape HTTP Cookie File\n' + cookies.map(c => {
            const domainFlag = c.domain.startsWith('.') ? 'TRUE' : 'FALSE';
            const expires = c.expires === -1 || c.expires === 0 ? Math.floor(Date.now() / 1000) + 31536000 : Math.floor(c.expires);
            return `${c.domain}\t${domainFlag}\t${c.path}\t${c.secure.toString().toUpperCase()}\t${expires}\t${c.name}\t${c.value}`;
        }).join('\n');

    } finally {
        await browser.close();
    }
};

export async function POST(req: Request) {
    let cookiesFilePath: string | null = null;
    let cookiesTempDir: string | null = null;
    let requestUrl = '';
    try {
        let { url, cookiesText } = await req.json();

        if (!url) {
            return NextResponse.json({ error: 'URL is required' }, { status: 400 });
        }

        requestUrl = sanitizeInputUrl(url);
        if (!requestUrl) {
            return NextResponse.json({ error: 'URL is required' }, { status: 400 });
        }

        url = requestUrl;
        const resolvedCookies = resolveCookiesForRequest(url, cookiesText);
        const youtubeCookiesConfigured = isYouTubeUrl(url) && hasServerCookies('youtube');
        const userCookiesIgnored =
            Boolean(cookiesText?.trim()) &&
            Boolean(detectCookiePlatform(url)) &&
            !cookiesMatchPlatform(cookiesText.trim(), detectCookiePlatform(url)!);
        if (isYouTubeUrl(url) && resolvedCookies.cookiesText) {
            const diag = diagnoseYouTubeCookies(resolvedCookies.cookiesText);
            console.log(
                `[API] youtube cookies source=${resolvedCookies.source} lines=${diag.lineCount} youtubeLines=${diag.youtubeDomainLines} markers=${diag.foundMarkers.join(',')} missing=${diag.missingMarkers.join(',')} valid=${diag.looksValid}`
            );
        } else {
            console.log(
                `[API] cookie source=${resolvedCookies.source ?? 'none'} youtubeEnvConfigured=${youtubeCookiesConfigured}${userCookiesIgnored ? ' userCookiesIgnored=wrong-platform' : ''}`
            );
        }

        const resolvedUrl = isDouyinUrl(url) ? await resolveDouyinUrl(url) : url;
        if (resolvedUrl !== url) {
            devLog(`[API] Resolved short link to: ${resolvedUrl.substring(0, 60)}...`);
        }
        url = resolvedUrl;
        if (isYouTubeUrl(url)) {
            url = normalizeYouTubeUrl(url);
        }

        // Basic URL validation
        if (url.length > 500 || !url.startsWith('http')) {
            return NextResponse.json({ error: 'Please enter a valid video URL' }, { status: 400 });
        }

        const ytdl = createYtDlp();

        devLog(`[API] Extracting metadata for: ${url.substring(0, 50)}...`);

        // Determine referer based on URL
        let referer = 'https://www.youtube.com/';
        if (url.includes('bilibili.com') || url.includes('b23.tv')) {
            referer = 'https://www.bilibili.com/';
        } else if (url.includes('tiktok.com')) {
            referer = 'https://www.tiktok.com/';
        } else if (url.includes('douyin.com')) {
            referer = 'https://www.douyin.com/';
        } else if (url.includes('facebook.com') || url.includes('fb.watch')) {
            referer = 'https://www.facebook.com/';
        } else if (url.includes('instagram.com')) {
            referer = 'https://www.instagram.com/';
        }

        const usingYouTubeCookies = isYouTubeUrl(url) && Boolean(resolvedCookies.cookiesText);

        const cookiesFlag: any = {};
        let extraArgs: Record<string, string[]> = {
            tiktok: ['no-watermark'],
            bilibili: ['no-watermark'],
            douyin: ['no-watermark'],
        };
        if (url.includes('bilibili.com') || url.includes('b23.tv')) {
            referer = 'https://www.bilibili.com/';
        } else if (url.includes('tiktok.com')) {
            referer = 'https://www.tiktok.com/';
        } else if (url.includes('douyin.com')) {
            referer = 'https://www.douyin.com/';
            if (!isVercel()) {
                cookiesFlag.cookiesFromBrowser = 'chrome';
            }
        }

        const options: any = {
            dumpSingleJson: true,
            noCheckCertificates: true,
            noWarnings: true,
            preferFreeFormats: !isYouTubeUrl(url),
            noPlaylist: true,
            quiet: true,
            skipDownload: true,
            extractorArgs: extraArgs
        };

        if (resolvedCookies.cookiesText) {
            cookiesTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-cookies-'));
            cookiesFilePath = applyCookiesToYtDlpOptions(
                options,
                resolvedCookies.cookiesText,
                cookiesTempDir
            );
        } else if (cookiesFlag.cookiesFromBrowser) {
            options.cookiesFromBrowser = cookiesFlag.cookiesFromBrowser;
        }

        let output: any;

        if (isDouyinUrl(url)) {
            try {
                output = await extractDouyinNoCookie(url);
                return NextResponse.json(output);
            } catch (apiErr: any) {
                devLog('[API] Douyin API failed, falling back to yt-dlp:', apiErr.message);
            }

            const desktopHeaders = [
                `referer:${referer}`,
                'user-agent:Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
                'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                'Accept-Language: zh-CN,zh;q=0.9,en;q=0.8',
            ];

            // 1. Try yt-dlp Desktop
            try {
                if (cookiesFilePath) devLog('[API] Trying provided cookies...');
                else devLog('[API] Trying no-cookie request...');

                options.addHeader = desktopHeaders;
                output = await runYtDlpExtract(ytdl, url, options, usingYouTubeCookies);
            } catch (e: any) {
                devLog('[API] Desktop attempt failed. Switching to Mobile strategy...');

                // 2. Try Mobile User-Agent with same cookies
                if (cookiesFilePath) {
                    try {
                        devLog('[API] Retrying with provided cookies + Mobile UA...');
                        const mobileOptions = { ...options };
                        mobileOptions.addHeader = [
                            'user-agent:Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
                            'referer:https://www.douyin.com/'
                        ];
                        output = await runYtDlpExtract(ytdl, url, mobileOptions, usingYouTubeCookies);
                        devLog('[API] Mobile strategy with provided cookies successful!');
                        return NextResponse.json(output);
                    } catch (mobileCookieErr: any) {
                        devLog('[API] Mobile + Cookies failed also.');
                    }
                }

                // 3. Try Puppeteer fallback (only if no cookies provided or they failed)

                // 2. Try yt-dlp Mobile (iPhone)
                try {
                    const mobileOptions = { ...options };
                    mobileOptions.addHeader = [
                        'user-agent:Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
                        'referer:https://www.douyin.com/'
                    ];
                    output = await runYtDlpExtract(ytdl, url, mobileOptions, usingYouTubeCookies);
                    devLog('[API] Mobile strategy successful!');
                } catch (mobileErr: any) {
                    // 3. Try Puppeteer Cookies + Retry
                    devLog('[API] Mobile failed. Fetching fresh cookies via Puppeteer...');
                    try {
                        const cookieContent = await getFreshDouyinCookies(url);

                        // Create temp cookie file
                        if (!cookiesTempDir) cookiesTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-cookies-fallback-'));
                        const freshCookiesPath = path.join(cookiesTempDir, 'puppeteer_cookies.txt');
                        fs.writeFileSync(freshCookiesPath, cookieContent);

                        // Retry standard desktop extraction but with FRESH cookies
                        const retryOptions = { ...options };
                        retryOptions.cookies = freshCookiesPath;
                        retryOptions.addHeader = desktopHeaders;

                        devLog('[API] Retrying extraction with fresh cookies...');
                        output = await runYtDlpExtract(ytdl, url, retryOptions, usingYouTubeCookies);
                        devLog('[API] Puppeteer Cookie strategy successful!');

                    } catch (pe: any) {
                        if (!canUseBrowserAutomation()) {
                            throw e;
                        }
                        try {
                            output = await extractDouyinDirect(url);
                        } catch {
                            throw e;
                        }
                    }
                }
            }
        } else {
            // Non-douyin extraction
            options.addHeader = [
                `referer:${referer}`,
                'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
            ];
            try {
                output = await runYtDlpExtract(ytdl, url, options, usingYouTubeCookies);
            } catch (cookieErr: unknown) {
                if (isYouTubeUrl(url) && usingYouTubeCookies) {
                    devLog('[API] YouTube extract with cookies failed, retrying without cookies...');
                    const noCookieOptions = { ...options };
                    delete noCookieOptions.cookies;
                    output = await runYtDlpExtract(ytdl, url, noCookieOptions, false);
                } else {
                    throw cookieErr;
                }
            }
        }

        devLog(`[API] Successfully extracted metadata for: ${output.title}`);
        return NextResponse.json(output);

    } catch (error: any) {
        console.error('Extraction error:', error);
        const errorMessage = error.stderr || error.message || 'Failed to extract video information';
        const mapped = mapExtractError(errorMessage, requestUrl);
        return NextResponse.json(
            { error: mapped.error, details: errorMessage },
            { status: mapped.status }
        );
    } finally {
        try {
            if (cookiesFilePath && fs.existsSync(cookiesFilePath)) {
                fs.unlinkSync(cookiesFilePath);
            }
            if (cookiesTempDir && fs.existsSync(cookiesTempDir)) {
                fs.rmSync(cookiesTempDir, { recursive: true, force: true });
            }
        } catch { }
    }
}
