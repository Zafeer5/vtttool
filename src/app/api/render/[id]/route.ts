import { NextRequest, NextResponse } from 'next/server';
import { cancelRenderJob, deleteRenderJob, getRenderJob } from '@/lib/render-jobs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const job = await getRenderJob(id);
    if (!job) {
      return NextResponse.json(
        { success: false, error: 'Render job was not found.' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, job }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Could not read render job status.';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const { retryRenderJob } = await import('@/lib/render-jobs');
    const job = await retryRenderJob(id);
    if (!job) {
      return NextResponse.json(
        { success: false, error: 'Render job not found for retry.' },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true, job });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Could not retry render job.';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const cancelled = await cancelRenderJob(id);
    if (!cancelled) {
      const deleted = await deleteRenderJob(id);
      return NextResponse.json({ success: true, deleted });
    }
    return NextResponse.json({ success: true, cancelled: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Could not cancel or delete render job.';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
