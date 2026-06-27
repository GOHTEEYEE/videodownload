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

export const resolveCookiesForRequest = (
    url: string,
    userCookiesText?: string | null
): { cookiesText: string | null; source: 'user' | 'server' | null } => {
    const trimmed = typeof userCookiesText === 'string' ? userCookiesText.trim() : '';
    if (trimmed) {
        return { cookiesText: trimmed, source: 'user' };
    }

    const server = getServerCookieText(url);
    if (server) {
        return { cookiesText: server, source: 'server' };
    }

    return { cookiesText: null, source: null };
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
