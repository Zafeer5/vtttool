import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getVideoFilePath, deleteRenderedVideo, getLibraryDir } from '@/lib/render-library';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const filePath = await getVideoFilePath(id);

    if (!filePath || !fs.existsSync(filePath)) {
      return NextResponse.json(
        { success: false, error: 'Video not found or has expired after 24 hours.' },
        { status: 404 }
      );
    }

    const stat = await fs.promises.stat(filePath);
    const fileSize = stat.size;
    const url = new URL(req.url);
    const isDownload = url.searchParams.get('download') === '1';

    // Support HTTP Range Requests for video streaming & scrubbing
    const range = req.headers.get('range');

    if (range && !isDownload) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      const fileStream = fs.createReadStream(filePath, { start, end });

      // Convert Node stream to Web ReadableStream
      const webStream = new ReadableStream({
        start(controller) {
          fileStream.on('data', (chunk) => controller.enqueue(chunk));
          fileStream.on('end', () => controller.close());
          fileStream.on('error', (err) => controller.error(err));
        },
        cancel() {
          fileStream.destroy();
        },
      });

      return new NextResponse(webStream, {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(chunkSize),
          'Content-Type': 'video/mp4',
        },
      });
    }

    // Full file response / download
    const fileStream = fs.createReadStream(filePath);
    const webStream = new ReadableStream({
      start(controller) {
        fileStream.on('data', (chunk) => controller.enqueue(chunk));
        fileStream.on('end', () => controller.close());
        fileStream.on('error', (err) => controller.error(err));
      },
      cancel() {
        fileStream.destroy();
      },
    });

    const isZip = filePath.endsWith('.zip');
    const contentType = isZip ? 'application/zip' : 'video/mp4';
    const ext = isZip ? '.zip' : '.mp4';

    const requestedFilename = url.searchParams.get('filename');
    let downloadFileName = requestedFilename?.trim() || `${id}${ext}`;
    if (!requestedFilename) {
      const jsonPath = path.join(getLibraryDir(), `${id}.json`);
      if (fs.existsSync(jsonPath)) {
        try {
          const meta = JSON.parse(await fs.promises.readFile(jsonPath, 'utf-8'));
          if (meta.filename) {
            downloadFileName = meta.filename;
          } else if (meta.title) {
            const safeTitle = meta.title.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
            downloadFileName = safeTitle.endsWith(ext) ? safeTitle : `${safeTitle}${ext}`;
          }
        } catch {}
      }
    }

    if (!downloadFileName.toLowerCase().endsWith(ext)) {
      downloadFileName = `${downloadFileName.replace(/\.(mp4|zip)$/i, '')}${ext}`;
    }

    const safeAscii = downloadFileName.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
    const encodedUtf8 = encodeURIComponent(downloadFileName);

    const disposition = isDownload || isZip
      ? `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodedUtf8}`
      : `inline; filename="${safeAscii}"; filename*=UTF-8''${encodedUtf8}`;

    return new NextResponse(webStream, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(fileSize),
        'Content-Disposition': disposition,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error: any) {
    console.error('Error serving rendered video:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Error serving video' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const deleted = await deleteRenderedVideo(id);

    if (!deleted) {
      return NextResponse.json(
        { success: false, error: 'Video not found or already deleted.' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Video successfully removed from library.',
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to delete video' },
      { status: 500 }
    );
  }
}
