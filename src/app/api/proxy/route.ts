import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const url = searchParams.get('url');
    const filename = searchParams.get('filename') || 'video.mp4';
    const referer = searchParams.get('referer');

    if (!url) {
        return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    try {
        const headers: Record<string, string> = {
            Accept: '*/*',
        };
        if (referer?.includes('facebook.com')) {
            headers['User-Agent'] = 'facebookexternalhit/1.1';
            headers.Referer = referer;
        } else {
            headers['User-Agent'] =
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
            if (referer) {
                headers.Referer = referer;
            }
        }

        const response = await fetch(url, { headers, redirect: 'follow' });

        if (!response.ok) {
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

        return new Response(response.body, {
            status: 200,
            headers: outHeaders,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Proxy failed';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
