import { NextRequest } from 'next/server';
import { getRenderJob, subscribeToJob, RenderJob } from '@/lib/render-jobs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Server-Sent Events (SSE) Route for real-time video render progress updates.
 * Directly eliminates polling bottleneck and UI thread locking.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const initialJob = await getRenderJob(id);

    if (!initialJob) {
      return new Response(
        JSON.stringify({ success: false, error: 'Render job was not found.' }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();

        const sendEvent = (job: RenderJob) => {
          try {
            const dataStr = JSON.stringify(job);
            controller.enqueue(encoder.encode(`data: ${dataStr}\n\n`));
          } catch {
            // Stream might already be closed by client abort
          }
        };

        // Immediately send current job snapshot to client
        sendEvent(initialJob);

        if (
          initialJob.status === 'completed' ||
          initialJob.status === 'failed' ||
          initialJob.status === 'cancelled'
        ) {
          try {
            controller.close();
          } catch {}
          return;
        }

        // Subscribe to real-time event updates from backend engine
        const unsubscribe = subscribeToJob(id, (updatedJob) => {
          sendEvent(updatedJob);
          if (
            updatedJob.status === 'completed' ||
            updatedJob.status === 'failed' ||
            updatedJob.status === 'cancelled'
          ) {
            unsubscribe();
            try {
              controller.close();
            } catch {}
          }
        });

        // Periodic keep-alive comment every 15 seconds
        const heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(': heartbeat\n\n'));
          } catch {
            clearInterval(heartbeat);
          }
        }, 15000);

        request.signal.addEventListener('abort', () => {
          unsubscribe();
          clearInterval(heartbeat);
          try {
            controller.close();
          } catch {}
        });
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to establish event stream.';
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
