import { NextResponse } from 'next/server';

const getLogStore = () => {
    const globalAny: any = globalThis;
    if (!globalAny.jobLogs) globalAny.jobLogs = {};
    return globalAny.jobLogs;
};

const getJobCache = () => {
    const globalAny: any = globalThis;
    if (!globalAny.jobCache) globalAny.jobCache = {};
    return globalAny.jobCache;
};

export const runtime = 'nodejs';

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get('jobId');

    if (!jobId) return NextResponse.json({ logs: [] });

    const logStore = getLogStore();
    const jobCache = getJobCache();

    const logs = logStore[jobId] || [];
    const job = jobCache[jobId];

    // Determine status: check explicit cache status OR log messages
    const isReady = job?.status === 'ready' || logs.some((l: string) => l.includes('Ready for browser download'));

    // Return only the last 20 logs to keep the response small and prevent browser lag
    const recentLogs = logs.slice(-20);

    const progress = Math.min(Math.max(job?.progress || 0, 0), 100);

    return NextResponse.json({
        logs: recentLogs,
        status: isReady ? 'done' : (job?.status || 'processing'),
        progress,
        error: job?.error,
        path: job?.filePath,
        filename: job?.filename,
        downloadUrl: job?.downloadUrl || null,
        qualityNotice: job?.qualityNotice || null,
    });
}
