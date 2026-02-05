import { NextResponse } from 'next/server';
import fs from 'fs';

const getJobCache = () => {
    const globalAny: any = globalThis;
    if (!globalAny.jobCache) globalAny.jobCache = {};
    return globalAny.jobCache;
};

const getLogStore = () => {
    const globalAny: any = globalThis;
    if (!globalAny.jobLogs) globalAny.jobLogs = {};
    return globalAny.jobLogs;
};

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get('jobId');

    if (!jobId) return new Response('Job ID required', { status: 400 });

    const jobCache = getJobCache();
    const job = jobCache[jobId];

    if (!job || job.status !== 'ready' || !job.filePath) {
        return new Response('File not ready or expired', { status: 404 });
    }

    try {
        const fileStream = fs.createReadStream(job.filePath);
        const stats = fs.statSync(job.filePath);

        // Standard compliant filename
        const safeTitle = job.filename.replace(/[^\w\s\-\.\u4e00-\u9fa5]/g, '').trim();
        const filename = encodeURIComponent(safeTitle);

        // Clean up AFTER the file is fully sent? 
        // With stream, we can't delete immediately. 
        // We will schedule a cleanup after 5 minutes.
        setTimeout(() => {
            try {
                if (fs.existsSync(job.tempDir)) fs.rmSync(job.tempDir, { recursive: true, force: true });
                delete jobCache[jobId];
                delete getLogStore()[jobId];
            } catch (e) { console.error('Cleanup error', e); }
        }, 5 * 60 * 1000);

        // Browser Stream
        const stream = new ReadableStream({
            async start(controller) {
                fileStream.on('data', (chunk) => controller.enqueue(chunk));
                fileStream.on('end', () => controller.close());
                fileStream.on('error', (err) => controller.error(err));
            }
        });

        return new Response(stream, {
            headers: {
                'Content-Type': 'video/mp4',
                'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
                'Content-Length': stats.size.toString(),
            },
        });

    } catch (e: any) {
        return new Response('Error streaming file', { status: 500 });
    }
}
