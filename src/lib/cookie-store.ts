import fs from 'fs';
import path from 'path';

export type CookiePlatform = 'youtube' | 'tiktok' | 'douyin' | 'instagram' | 'facebook';

const PLATFORM_ENV: Record<CookiePlatform, string> = {
    youtube: 'COOKIES_YOUTUBE',
    tiktok: 'COOKIES_TIKTOK',
    douyin: 'COOKIES_DOUYIN',
    instagram: 'COOKIES_INSTAGRAM',
    facebook: 'COOKIES_FACEBOOK',
};

export const detectCookiePlatform = (url: string): CookiePlatform | null => {
    if (/youtube\.com|youtu\.be/i.test(url)) return 'youtube';
    if (/tiktok\.com/i.test(url)) return 'tiktok';
    if (/douyin\.com|iesdouyin\.com|v\.douyin\.com/i.test(url)) return 'douyin';
    if (/instagram\.com/i.test(url)) return 'instagram';
    if (/facebook\.com|fb\.watch/i.test(url)) return 'facebook';
    return null;
};

const YOUTUBE_COOKIE_MARKERS = [
    'LOGIN_INFO',
    '__Secure-1PSID',
    '__Secure-3PSID',
    'SID',
    'SAPISID',
] as const;

export type YouTubeCookieDiagnostics = {
    lineCount: number;
    youtubeDomainLines: number;
    hasTabs: boolean;
    hasNetscapeHeader: boolean;
    foundMarkers: string[];
    missingMarkers: string[];
    looksValid: boolean;
};

/** Normalize cookie text from env vars (literal \\n, missing header). */
export const normalizeCookieText = (raw: string): string => {
    let text = raw.trim();
    if (!text.includes('\n') && text.includes('\\n')) {
        text = text.replace(/\\n/g, '\n');
    }
    if (!text.startsWith('# Netscape') && text.includes('\t')) {
        text = `# Netscape HTTP Cookie File\n${text}`;
    }
    return text;
};

export const diagnoseYouTubeCookies = (cookiesText: string): YouTubeCookieDiagnostics => {
    const normalized = normalizeCookieText(cookiesText);
    const lines = normalized.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
    const foundMarkers = YOUTUBE_COOKIE_MARKERS.filter((m) => normalized.includes(m));
    const missingMarkers = YOUTUBE_COOKIE_MARKERS.filter((m) => !normalized.includes(m));
    const youtubeDomainLines = lines.filter((l) => l.includes('.youtube.com')).length;

    return {
        lineCount: lines.length,
        youtubeDomainLines,
        hasTabs: normalized.includes('\t'),
        hasNetscapeHeader: normalized.startsWith('# Netscape'),
        foundMarkers: [...foundMarkers],
        missingMarkers: [...missingMarkers],
        looksValid:
            lines.length >= 3 &&
            normalized.includes('\t') &&
            youtubeDomainLines >= 1 &&
            foundMarkers.length >= 2,
    };
};

const readEnvCookie = (platform: CookiePlatform): string | null => {
    const base = PLATFORM_ENV[platform];
    const raw = process.env[base]?.trim();
    if (raw) return normalizeCookieText(raw);

    const b64 = process.env[`${base}_BASE64`]?.trim();
    if (b64) {
        try {
            return normalizeCookieText(Buffer.from(b64, 'base64').toString('utf8'));
        } catch {
            return null;
        }
    }

    const filePath = process.env[`${base}_FILE`]?.trim();
    if (filePath) {
        try {
            const resolved = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
            if (fs.existsSync(resolved)) {
                return fs.readFileSync(resolved, 'utf8').trim();
            }
        } catch {
            return null;
        }
    }

    return null;
};

export const hasServerCookies = (platform: CookiePlatform): boolean =>
    Boolean(readEnvCookie(platform));

export const getServerCookieText = (url: string): string | null => {
    const platform = detectCookiePlatform(url);
    if (!platform) return null;
    return readEnvCookie(platform);
};

const PLATFORM_COOKIE_MARKERS: Record<CookiePlatform, string[]> = {
    youtube: ['.youtube.com', 'youtube.com'],
    tiktok: ['.tiktok.com', 'tiktok.com'],
    douyin: ['.douyin.com', 'douyin.com', 'iesdouyin.com'],
    instagram: ['.instagram.com', 'instagram.com'],
    facebook: ['.facebook.com', 'facebook.com'],
};

/** True when pasted cookies belong to the platform for this URL (avoids TikTok cookies on YouTube). */
export const cookiesMatchPlatform = (cookiesText: string, platform: CookiePlatform): boolean => {
    const normalized = normalizeCookieText(cookiesText);
    return PLATFORM_COOKIE_MARKERS[platform].some((marker) => normalized.includes(marker));
};

export const resolveCookiesForRequest = (
    url: string,
    userCookiesText?: string | null
): { cookiesText: string | null; source: 'user' | 'server' | null } => {
    const platform = detectCookiePlatform(url);
    const trimmed = typeof userCookiesText === 'string' ? userCookiesText.trim() : '';

    if (trimmed && platform && cookiesMatchPlatform(trimmed, platform)) {
        return { cookiesText: trimmed, source: 'user' };
    }

    const server = getServerCookieText(url);
    if (server) {
        return { cookiesText: server, source: 'server' };
    }

    return { cookiesText: null, source: null };
};

const domainMatches = (cookieDomain: string, host: string): boolean => {
    const normalized = cookieDomain.startsWith('.') ? cookieDomain.slice(1) : cookieDomain;
    return host === normalized || host.endsWith(`.${normalized}`);
};

/** Build a Cookie header for a CDN request from Netscape cookies.txt text. */
export const cookiesToHeader = (cookiesText: string, targetUrl: string): string | null => {
    let host: string;
    try {
        host = new URL(targetUrl).hostname.toLowerCase();
    } catch {
        return null;
    }

    const normalized = normalizeCookieText(cookiesText);
    if (!normalized.includes('\t') && !normalized.startsWith('Cookie:')) {
        return normalized;
    }
    if (normalized.startsWith('Cookie:')) {
        return normalized.slice('Cookie:'.length).trim();
    }

    const pairs: string[] = [];
    for (const line of normalized.split('\n')) {
        if (!line.trim() || line.startsWith('#')) continue;
        const parts = line.split('\t');
        if (parts.length < 7) continue;
        const domain = parts[0];
        const name = parts[5];
        const value = parts[6];
        if (domainMatches(domain, host)) {
            pairs.push(`${name}=${value}`);
        }
    }

    return pairs.length > 0 ? pairs.join('; ') : null;
};

export const resolveCookiesForProxy = (
    referer: string | undefined,
    targetUrl: string,
    userCookiesText?: string | null
): string | null => {
    const pageUrl = referer || targetUrl;
    const platform = detectCookiePlatform(pageUrl);
    const trimmed = typeof userCookiesText === 'string' ? userCookiesText.trim() : '';
    if (trimmed && platform && cookiesMatchPlatform(trimmed, platform)) {
        return cookiesToHeader(trimmed, targetUrl);
    }
    const server = getServerCookieText(pageUrl);
    if (server) {
        return cookiesToHeader(server, targetUrl);
    }
    return null;
};

export type ProxyFetchOptions = {
    url: string;
    referer?: string | null;
    cookiesText?: string | null;
    range?: string | null;
};

export const buildProxyRequestHeaders = (options: ProxyFetchOptions): Record<string, string> => {
    const { url, referer, cookiesText, range } = options;
    const headers: Record<string, string> = {
        Accept: '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
    };

    const platform = detectCookiePlatform(referer || url);
    if (platform === 'facebook' || url.includes('fbcdn.net')) {
        headers['User-Agent'] = 'facebookexternalhit/1.1';
        headers.Referer = referer || 'https://www.facebook.com/';
    } else if (platform === 'tiktok' || url.includes('tiktokcdn.com') || url.includes('tiktokv.com')) {
        headers['User-Agent'] =
            'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';
        headers.Referer = referer || 'https://www.tiktok.com/';
    } else {
        headers['User-Agent'] =
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
        if (referer) headers.Referer = referer;
    }

    const cookieHeader = resolveCookiesForProxy(referer || undefined, url, cookiesText);
    if (cookieHeader) {
        headers.Cookie = cookieHeader;
    }

    if (range) {
        headers.Range = range;
    }

    return headers;
};

/** Write cookies into yt-dlp options; returns temp file path when a file was created. */
export const applyCookiesToYtDlpOptions = (
    options: Record<string, unknown>,
    cookiesText: string,
    cookiesDir: string
): string | null => {
    const trimmed = normalizeCookieText(cookiesText);
    if (!trimmed) return null;

    if (trimmed.startsWith('# Netscape') || trimmed.includes('\t')) {
        fs.mkdirSync(cookiesDir, { recursive: true });
        const cookiesFilePath = path.join(cookiesDir, 'cookies.txt');
        fs.writeFileSync(cookiesFilePath, trimmed);
        options.cookies = cookiesFilePath;
        return cookiesFilePath;
    }

    if (!options.addHeader) options.addHeader = [];
    (options.addHeader as string[]).push(`Cookie:${trimmed}`);
    return null;
};
