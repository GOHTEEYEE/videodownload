import { NextResponse } from 'next/server';
import youtubedl from 'youtube-dl-exec';
import { execSync } from 'child_process';
import fs from 'fs';

// Helper to find yt-dlp path
const getYtDlpPath = () => {
    try {
        // Check local directory first
        const localPath = process.cwd() + '/yt-dlp';
        if (fs.existsSync(localPath)) {
            return localPath;
        }

        return execSync('which yt-dlp').toString().trim();
    } catch {
        // If which fails, try common locations
        const paths = ['/usr/local/bin/yt-dlp', '/opt/homebrew/bin/yt-dlp'];
        for (const p of paths) {
            if (fs.existsSync(p)) {
                return p;
            }
        }
        return 'yt-dlp'; // Fallback to PATH
    }
};

export async function POST(req: Request) {
    try {
        const { url } = await req.json();

        if (!url) {
            return NextResponse.json({ error: 'URL is required' }, { status: 400 });
        }

        // Basic URL validation to prevent massive text blocks from crashing the shell
        if (url.length > 500 || !url.startsWith('http')) {
            return NextResponse.json({ error: 'Please enter a valid video URL' }, { status: 400 });
        }

        const binaryPath = getYtDlpPath();
        const ytdl = youtubedl.create(binaryPath);

        console.log(`[API] Extracting metadata for: ${url.substring(0, 50)}...`);

        // Get video information with performance-optimized flags
        const output: any = await ytdl(url, {
            dumpSingleJson: true,
            noCheckCertificates: true,
            noWarnings: true,
            preferFreeFormats: true,
            noPlaylist: true,          // Don't scan entire playlists (much faster)
            quiet: true,               // Less overhead
            skipDownload: true,        // Explicitly skip download for extraction
            addHeader: [
                'referer:youtube.com',
                'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            ]
        });

        console.log(`[API] Successfully extracted metadata for: ${output.title}`);

        return NextResponse.json(output);
    } catch (error: any) {
        console.error('Extraction error:', error);

        // Check if it's a known yt-dlp error
        const errorMessage = error.stderr || error.message || 'Failed to extract video information';

        return NextResponse.json(
            { error: errorMessage.includes('not a valid URL') ? 'Invalid URL provided' : errorMessage },
            { status: 500 }
        );
    }
}

