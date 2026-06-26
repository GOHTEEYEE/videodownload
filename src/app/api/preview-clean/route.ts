import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createYtDlp } from '@/lib/ytdlp';

export const runtime = 'nodejs';
export const maxDuration = 60;

const getJobCache = () => {
    const globalAny: any = globalThis;
    if (!globalAny.jobCache) globalAny.jobCache = {};
    return globalAny.jobCache;
};

export async function POST(req: Request) {
    try {
        const { url, formatId, manualAreas } = await req.json();
        const jobId = `preview_${Date.now()}`;
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'luxe-preview-'));
        const outputPath = path.join(tempDir, 'preview.mp4');

        // 1. Get direct URL
        const ytdl = createYtDlp();
        const info: any = await ytdl(url, {
            dumpSingleJson: true,
            format: formatId ? `${formatId}+bestaudio/best` : 'best',
            noCheckCertificates: true,
        });

        const videoUrl = info.url || info.formats.find((f: any) => f.format_id === formatId)?.url;
        if (!videoUrl) throw new Error('Could not extract stream URL');

        // 2. Build FFmpeg command for 3s preview
        let delogoFilters: string[] = [];
        if (manualAreas && manualAreas.length > 0) {
            manualAreas.forEach((area: any) => {
                const x = `max(0,round(in_w*${area.x/100}))`;
                const y = `max(0,round(in_h*${area.y/100}))`;
                const w = `max(1,round(in_w*${area.w/100}))`;
                const h = `max(1,round(in_h*${area.h/100}))`;
                // Preview gets standard delogo
                delogoFilters.push(`delogo=x=${x}:y=${y}:w=${w}:h=${h}`);
            });
        }
        
        const filterStr = delogoFilters.length > 0 ? delogoFilters.join(',') : 'null';
        
        const ffmpegArgs = [
            '-ss', '00:00:05',
            '-i', videoUrl,
            '-t', '3',
            '-vf', filterStr,
            '-c:v', 'h264_videotoolbox', // Apple Hardware Acceleration
            '-b:v', '2000k',
            '-an', // No audio for speed
            '-y',
            outputPath
        ];

        await new Promise((resolve, reject) => {
            const proc = spawn('ffmpeg', ffmpegArgs);
            proc.on('close', (code) => code === 0 ? resolve(true) : reject(new Error(`FFmpeg exited with ${code}`)));
            proc.on('error', reject);
        });

        // 3. Store in cache for serving
        const jobCache = getJobCache();
        jobCache[jobId] = {
            status: 'ready',
            filePath: outputPath,
            tempDir: tempDir,
            filename: 'preview.mp4'
        };

        return NextResponse.json({ previewUrl: `/api/serve?jobId=${jobId}` });

    } catch (e: any) {
        console.error('Preview error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
