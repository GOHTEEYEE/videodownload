import { canUseBrowserAutomation, devLog } from '@/lib/env';

export const sanitizeInputUrl = (raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed) return '';

    const urlMatch = trimmed.match(/https?:\/\/[^\s<>"']+/i);
    if (urlMatch) {
        return urlMatch[0].replace(/[,.;:!?，。！？、]+$/u, '');
    }

    return trimmed.split(/\s+/)[0];
};

export const DOUYIN_UA_DESKTOP =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

export const DOUYIN_UA_MOBILE =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';

export const isDouyinUrl = (url: string) =>
    /douyin\.com|iesdouyin\.com|v\.douyin\.com/.test(url);

export const extractAwemeId = (inputUrl: string): string | null => {
    if (!isDouyinUrl(inputUrl) && !inputUrl.includes('v.douyin.com')) {
        return null;
    }
    const patterns = [
        /\/video\/(\d+)/,
        /\/share\/video\/(\d+)/,
        /[?&]modal_id=(\d+)/,
        /[?&]aweme_id=(\d+)/,
    ];
    for (const pattern of patterns) {
        const match = inputUrl.match(pattern);
        if (match?.[1]) return match[1];
    }
    return null;
};

export const normalizeDouyinVideoUrl = (inputUrl: string) => {
    if (!isDouyinUrl(inputUrl) && !inputUrl.includes('v.douyin.com')) {
        return inputUrl;
    }
    const awemeId = extractAwemeId(inputUrl);
    if (awemeId) {
        return `https://www.douyin.com/video/${awemeId}`;
    }
    return inputUrl;
};

export const resolveDouyinUrl = async (inputUrl: string) => {
    if (!isDouyinUrl(inputUrl) && !inputUrl.includes('v.douyin.com')) {
        return inputUrl;
    }

    const normalized = normalizeDouyinVideoUrl(inputUrl);
    if (extractAwemeId(normalized)) return normalized;

    if (!inputUrl.includes('v.douyin.com')) return normalized;

    try {
        let current = inputUrl;
        for (let i = 0; i < 5; i++) {
            const res = await fetch(current, {
                redirect: 'manual',
                headers: {
                    'user-agent': DOUYIN_UA_DESKTOP,
                    referer: 'https://www.douyin.com/',
                },
            });
            const location = res.headers.get('location');
            if (location) {
                current = location.startsWith('http') ? location : new URL(location, current).toString();
                const awemeId = extractAwemeId(current);
                if (awemeId) return `https://www.douyin.com/video/${awemeId}`;
                continue;
            }
            const text = await res.text();
            const match = text.match(/https?:\/\/www\.douyin\.com\/video\/\d+/) ||
                text.match(/modal_id=(\d+)/);
            if (match?.[0]?.startsWith('http')) return normalizeDouyinVideoUrl(match[0]);
            if (match?.[1]) return `https://www.douyin.com/video/${match[1]}`;
            break;
        }
    } catch {
        // best-effort only
    }

    return normalized;
};

type AwemeDetailResponse = {
    aweme_detail?: Record<string, any>;
    status_code?: number;
};

type FormatCandidate = {
    url: string;
    height: number;
    width: number;
    note: string;
    priority: number;
    filesize?: number;
};

const fetchAwemeDetailHttp = async (awemeId: string): Promise<Record<string, any>> => {
    const apiUrl =
        `https://www.douyin.com/aweme/v1/web/aweme/detail/?device_platform=webapp&aid=6383` +
        `&channel=channel_pc_web&aweme_id=${encodeURIComponent(awemeId)}`;

    const response = await fetch(apiUrl, {
        headers: {
            'User-Agent': DOUYIN_UA_DESKTOP,
            Referer: `https://www.douyin.com/video/${awemeId}`,
            Accept: 'application/json, text/plain, */*',
        },
        redirect: 'follow',
    });

    if (!response.ok) {
        throw new Error(`Douyin API HTTP ${response.status}`);
    }

    const data = (await response.json()) as AwemeDetailResponse;
    if (data.aweme_detail) {
        return data.aweme_detail;
    }

    throw new Error('Douyin API response missing aweme_detail');
};

const fetchAwemeDetail = async (pageUrl: string, awemeId: string): Promise<Record<string, any>> => {
    if (canUseBrowserAutomation()) {
        try {
            return await fetchAwemeDetailWithBrowser(pageUrl);
        } catch (browserErr) {
            devLog('[Douyin] Browser detail fetch failed, trying HTTP API:', browserErr);
        }
    }

    return fetchAwemeDetailHttp(awemeId);
};

const fetchAwemeDetailWithBrowser = async (pageUrl: string): Promise<Record<string, any>> => {
    if (!canUseBrowserAutomation()) {
        throw new Error('Douyin browser extraction is unavailable in this environment');
    }

    const puppeteer = await import('puppeteer');
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
        const page = await browser.newPage();
        await page.setUserAgent(DOUYIN_UA_DESKTOP);

        let awemeDetail: Record<string, any> | null = null;
        page.on('response', async (response) => {
            if (!response.url().includes('/aweme/v1/web/aweme/detail/')) return;
            try {
                const text = await response.text();
                if (text.length > 100) {
                    const parsed = JSON.parse(text) as AwemeDetailResponse;
                    if (parsed.aweme_detail) {
                        awemeDetail = parsed.aweme_detail;
                    }
                }
            } catch {
                // ignore parse errors
            }
        });

        try {
            await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        } catch {
            // page may still trigger detail API before full load
        }

        for (let i = 0; i < 30 && !awemeDetail; i++) {
            await new Promise((r) => setTimeout(r, 500));
        }

        if (!awemeDetail) {
            throw new Error('Douyin detail API not captured');
        }

        return awemeDetail;
    } finally {
        await browser.close();
    }
};

const buildPlayApiUrl = (uri: string) =>
    `https://aweme.snssdk.com/aweme/v1/play/?video_id=${encodeURIComponent(uri)}&ratio=1080p&line=0`;

const collectFormatCandidates = (video: Record<string, any>): FormatCandidate[] => {
    const candidates: FormatCandidate[] = [];
    const seen = new Set<string>();
    const hasWatermark = video.has_watermark !== false;
    const watermarkSize = video.download_addr?.data_size;

    const add = (
        url: string | undefined,
        height: number,
        width: number,
        note: string,
        priority: number,
        filesize?: number
    ) => {
        if (!url || seen.has(url) || url.includes('playwm')) return;
        if (hasWatermark && filesize && watermarkSize && filesize === watermarkSize) return;
        seen.add(url);
        candidates.push({ url, height, width, note, priority, filesize });
    };

    const defaultHeight = video.height || 1080;
    const defaultWidth = video.width || Math.round(defaultHeight * 9 / 16);
    const uri = video.play_addr?.uri;

    if (uri) {
        add(
            buildPlayApiUrl(uri),
            defaultHeight,
            defaultWidth,
            'No watermark (play API)',
            10000,
            video.play_addr?.data_size
        );
    }

    add(
        video.play_addr_h264?.url_list?.[0],
        video.play_addr_h264?.height || defaultHeight,
        video.play_addr_h264?.width || defaultWidth,
        'No watermark (h264)',
        9500,
        video.play_addr_h264?.data_size
    );

    add(
        video.play_addr?.url_list?.[0],
        defaultHeight,
        defaultWidth,
        'No watermark (play)',
        9000,
        video.play_addr?.data_size
    );

    const bitRates = [...(video.bit_rate || [])].sort(
        (a, b) => (b.play_addr?.height || 0) - (a.play_addr?.height || 0)
    );
    for (const item of bitRates) {
        const playAddr = item.play_addr;
        add(
            playAddr?.url_list?.[0],
            playAddr?.height || defaultHeight,
            playAddr?.width || defaultWidth,
            item.gear_name || 'bitrate',
            1000 + (playAddr?.height || 0),
            playAddr?.data_size
        );
    }

    if (!hasWatermark) {
        add(
            video.download_addr?.url_list?.[0],
            defaultHeight,
            defaultWidth,
            'download_addr',
            100,
            video.download_addr?.data_size
        );
    }

    candidates.sort((a, b) => b.priority - a.priority);
    return candidates;
};

export const pickBestDouyinFormat = (formats: Array<{ format_id?: string; format_note?: string; url?: string }>) => {
    return (
        formats.find((f) => f.format_id === 'best') ||
        formats.find((f) => f.format_note?.includes('play API')) ||
        formats.find((f) => !f.url?.includes('playwm')) ||
        formats[0]
    );
};

export const mapAwemeDetailToExtractResult = (detail: Record<string, any>, pageUrl: string) => {
    const video = detail.video;
    if (!video) {
        throw new Error('Douyin response missing video payload');
    }

    const candidates = collectFormatCandidates(video);
    if (candidates.length === 0) {
        throw new Error('No playable Douyin formats found');
    }

    const author = detail.author || {};
    const stats = detail.statistics || {};
    const awemeId = String(detail.aweme_id || extractAwemeId(pageUrl) || 'unknown');
    const thumbnail =
        detail.video?.cover?.url_list?.[0] ||
        detail.video?.origin_cover?.url_list?.[0] ||
        '';

    return {
        id: awemeId,
        title: (detail.desc || 'Douyin Video').replace(/\s*-\s*抖音\s*$/, '').trim(),
        description: detail.desc || '',
        thumbnail,
        duration: video.duration ? video.duration / 1000 : 0,
        uploader: author.nickname || 'Douyin User',
        uploader_id: author.unique_id || author.sec_uid || '',
        view_count: stats.play_count || 0,
        like_count: stats.digg_count || 0,
        extractor: 'Douyin',
        extractor_key: 'Douyin',
        webpage_url: pageUrl,
        formats: candidates.map((candidate, index) => ({
            format_id: index === 0 ? 'best' : `format_${index}`,
            url: candidate.url,
            ext: 'mp4',
            filesize: candidate.filesize,
            height: candidate.height,
            width: candidate.width,
            vcodec: 'h264',
            acodec: 'aac',
            protocol: 'https',
            format_note: candidate.note,
        })),
    };
};

export const extractDouyinNoCookie = async (inputUrl: string) => {
    const pageUrl = await resolveDouyinUrl(inputUrl);
    const awemeId = extractAwemeId(pageUrl);
    if (!awemeId) {
        throw new Error('Could not parse Douyin video ID');
    }

    const canonicalUrl = `https://www.douyin.com/video/${awemeId}`;
    devLog(`[Douyin API] Fetching no-watermark metadata for ${canonicalUrl}...`);
    const detail = await fetchAwemeDetail(canonicalUrl, awemeId);
    const result = mapAwemeDetailToExtractResult(detail, canonicalUrl);
    devLog(`[Douyin API] Found ${result.formats.length} no-watermark streams`);
    return result;
};

export const downloadDouyinStream = async (
    streamUrl: string,
    outputPath: string,
    log?: (msg: string) => void
) => {
    const logger = log || ((msg: string) => console.log(msg));
    logger(`[Douyin API] Downloading stream...`);

    const response = await fetch(streamUrl, {
        headers: {
            'User-Agent': DOUYIN_UA_MOBILE,
            Referer: 'https://www.douyin.com/',
        },
        redirect: 'follow',
    });

    if (!response.ok) {
        throw new Error(`Stream fetch failed: ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const fs = await import('fs');
    fs.writeFileSync(outputPath, buffer);
    logger(`[Douyin API] Downloaded ${(buffer.byteLength / 1024 / 1024).toFixed(2)} MB`);
};

export const downloadDouyinNoCookie = async (
    inputUrl: string,
    outputPath: string,
    log?: (msg: string) => void
) => {
    const metadata = await extractDouyinNoCookie(inputUrl);
    const best = pickBestDouyinFormat(metadata.formats);
    const bestUrl = best?.url;
    if (!bestUrl) {
        throw new Error('No Douyin download URL available');
    }
    await downloadDouyinStream(bestUrl, outputPath, log);
    return metadata;
};
