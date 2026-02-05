import { NextResponse } from 'next/server';

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const url = searchParams.get('url');
    const filename = searchParams.get('filename') || 'video.mp4';

    if (!url) {
        return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    try {
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Failed to fetch from source: ${response.statusText}`);
        }

        // Proxy the headers but force attachment and filename
        const headers = new Headers();
        headers.set('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
        headers.set('Content-Type', response.headers.get('Content-Type') || 'application/octet-stream');

        // Optional: proxy content-length
        const contentLength = response.headers.get('Content-Length');
        if (contentLength) {
            headers.set('Content-Length', contentLength);
        }

        return new Response(response.body, {
            status: response.status,
            headers,
        });
    } catch (error: any) {
        console.error('Proxy error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
