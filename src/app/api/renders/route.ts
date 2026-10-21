import { NextRequest, NextResponse } from 'next/server';
import { listRenderedVideos, saveRenderedVideo } from '@/lib/render-library';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const videos = await listRenderedVideos();
    return NextResponse.json({
      success: true,
      videos,
      count: videos.length,
      retentionPolicy: 'Videos are automatically removed from the library after 24 hours. Locally downloaded files are never affected.',
    });
  } catch (error: any) {
    console.error('Failed to list rendered videos:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to list rendered videos' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const videoFile = formData.get('video') as File | null;
    const duration = parseFloat((formData.get('duration') as string) || '0');
    const slideCount = parseInt((formData.get('slideCount') as string) || '1', 10);
    const resolution = (formData.get('resolution') as string) || '1080p';
    const title = (formData.get('title') as string) || undefined;

    if (!videoFile) {
      return NextResponse.json(
        { success: false, error: 'No video file provided.' },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await videoFile.arrayBuffer());

    const item = await saveRenderedVideo({
      tempVideoPath: '',
      videoBuffer: buffer,
      duration,
      slideCount,
      resolution,
      title,
    });

    return NextResponse.json({
      success: true,
      item,
      message: 'Video successfully saved to 24-hour library.',
    });
  } catch (error: any) {
    console.error('Failed to save video to library:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to save video to library' },
      { status: 500 }
    );
  }
}
