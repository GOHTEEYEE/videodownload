import { NextResponse } from 'next/server';
import { buildProxyRequestHeaders } from '@/lib/cookie-store';

export const runtime = 'nodejs';
export const maxDuration = 60;

type ProxyBody = {
    url?: string;
    referer?: string;
    filename?: string;
    cookiesText?: string;
};

const proxyFetch = async (options: {
    url: string;
    referer?: string | null;
    cookiesText?: string | null;
    range?: string | null;
}) => {
    const headers = buildProxyRequestHeaders(options);
    const response = await fetch(options.url, {
        headers,
        redirect: 'follow',
    });
    return { response, headers };
};

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const url = searchParams.get('url');
    const filename = searchParams.get('filename') || 'video.mp4';
    const referer = searchParams.get('referer');
    const range = req.headers.get('range');

    if (!url) {
        return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    try {
        const { response } = await proxyFetch({ url, referer, range });

        if (!response.ok) {
            console.error(
                `[proxy] upstream ${response.status} for ${url.substring(0, 80)} referer=${referer || 'none'}`
            );
            return NextResponse.json(
                { error: `Failed to fetch from source: ${response.status} ${response.statusText}` },
                { status: 502 }
            );
        }

        const outHeaders = new Headers();
        outHeaders.set(
            'Content-Disposition',
            `attachment; filename="${encodeURIComponent(filename)}"`
        );
        outHeaders.set(
            'Content-Type',
            response.headers.get('Content-Type') || 'application/octet-stream'
        );

        const contentLength = response.headers.get('Content-Length');
        if (contentLength) {
            outHeaders.set('Content-Length', contentLength);
        }

        const acceptRanges = response.headers.get('Accept-Ranges');
        if (acceptRanges) {
            outHeaders.set('Accept-Ranges', acceptRanges);
        }

        return new Response(response.body, {
            status: response.status,
            headers: outHeaders,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Proxy failed';
        console.error('[proxy] error:', message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

/** POST carries optional cookiesText so CDN fetches can reuse the same session as extract. */
export async function POST(req: Request) {
    let body: ProxyBody;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const url = body.url;
    if (!url) {
        return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    const range = req.headers.get('range');

    try {
        const { response } = await proxyFetch({
            url,
            referer: body.referer,
            cookiesText: body.cookiesText,
            range,
        });

        if (!response.ok) {
            console.error(
                `[proxy] POST upstream ${response.status} for ${url.substring(0, 80)} referer=${body.referer || 'none'}`
            );
            return NextResponse.json(
                { error: `Failed to fetch from source: ${response.status} ${response.statusText}` },
                { status: 502 }
            );
        }

        const outHeaders = new Headers();
        outHeaders.set('Content-Type', response.headers.get('Content-Type') || 'application/octet-stream');

        const contentLength = response.headers.get('Content-Length');
        if (contentLength) {
            outHeaders.set('Content-Length', contentLength);
        }

        return new Response(response.body, {
            status: response.status,
            headers: outHeaders,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Proxy failed';
        console.error('[proxy] POST error:', message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
