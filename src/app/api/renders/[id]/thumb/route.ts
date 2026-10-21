import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import { getThumbFilePath } from '@/lib/render-library';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const thumbPath = await getThumbFilePath(id);

    if (!thumbPath || !fs.existsSync(thumbPath)) {
      return NextResponse.json(
        { success: false, error: 'Thumbnail not found.' },
        { status: 404 }
      );
    }

    const buffer = await fs.promises.readFile(thumbPath);
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Error serving thumbnail' },
      { status: 500 }
    );
  }
}
