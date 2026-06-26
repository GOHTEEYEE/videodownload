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
    const directPath = searchParams.get('path'); // Fallback for old calls

    const jobCache = getJobCache();
    
    // Find job by ID OR by direct path (less secure but helps with compatibility)
    let job = jobId ? jobCache[jobId] : null;
    
    if (!job && directPath) {
        // Try to find job in cache that matches this path
        job = Object.values(jobCache).find((j: any) => j.filePath === directPath);
    }

    if (!job || !job.filePath || !fs.existsSync(job.filePath)) {
        console.error(`[Serve] File not found. JobId: ${jobId}, Path: ${directPath}`);
        return new Response('File not ready or expired. Please download again.', { status: 404 });
    }

    try {
        const stats = fs.statSync(job.filePath);
        const fileStream = fs.createReadStream(job.filePath);

        // Standard compliant filename
        const defaultName = job.mimeType === 'audio/mpeg' ? 'audio.mp3' : 'video.mp4';
        const safeTitle = (job.filename || defaultName).replace(/[^\w\s\-\.\u4e00-\u9fa5]/g, '').trim() || defaultName;
        const filename = encodeURIComponent(safeTitle);
        const contentType = job.mimeType || (safeTitle.endsWith('.mp3') ? 'audio/mpeg' : 'video/mp4');

        // Cleanup: Only if it's a temp file we created
        if (job.tempDir) {
            setTimeout(() => {
                try {
                    if (fs.existsSync(job.tempDir)) fs.rmSync(job.tempDir, { recursive: true, force: true });
                    if (jobId) {
                        delete jobCache[jobId];
                        delete getLogStore()[jobId];
                    }
                } catch (e) { console.error('Cleanup error', e); }
            }, 10 * 60 * 1000); // Increased to 10 mins
        }

        // Browser Stream with proper cleanup
        const stream = new ReadableStream({
            start(controller) {
                fileStream.on('data', (chunk) => controller.enqueue(chunk));
                fileStream.on('end', () => controller.close());
                fileStream.on('error', (err) => {
                    console.error('Stream error:', err);
                    controller.error(err);
                });
            },
            cancel() {
                fileStream.destroy();
            }
        });

        return new Response(stream, {
            headers: {
                'Content-Type': contentType,
                'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
                'Content-Length': stats.size.toString(),
                'Cache-Control': 'no-cache',
            },
        });

    } catch (e: any) {
        return new Response('Error streaming file', { status: 500 });
    }
}
