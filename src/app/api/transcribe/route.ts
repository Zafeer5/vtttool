import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

export const maxDuration = 300; // Allow up to 5 minutes
export const dynamic = 'force-dynamic';

function getPythonExe(): string {
  const candidates = [
    'C:\\Program Files\\Python314\\python.exe',
    'C:\\Python314\\python.exe',
    'C:\\Program Files\\Python313\\python.exe',
    'C:\\Program Files\\Python312\\python.exe',
    'C:\\Program Files\\Python311\\python.exe',
    'C:\\Program Files\\Python310\\python.exe',
  ];
  for (const c of candidates) {
    if (fs.existsSync(/*turbopackIgnore: true*/ c)) return c;
  }
  return process.platform === 'win32' ? 'python' : 'python3';
}

const responseHeaders = {
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: responseHeaders,
  });
}

export async function POST(req: NextRequest) {
  let tempFilePath: string | null = null;
  let tempOutputPath: string | null = null;

  try {
    const formData = await req.formData();
    const audioFile = formData.get('audio') as File | null;
    const model = (formData.get('model') as string) || 'small';
    const script = (formData.get('script') as string) || '';
    const rawLevel = (formData.get('level') as string) || 'chunk';
    const level = ['chunk', 'word', 'sentence'].includes(rawLevel) ? rawLevel : 'chunk';

    // Strictly locked to English
    const language = 'en';

    if (!audioFile) {
      return NextResponse.json(
        { success: false, error: 'No audio file provided in request.' },
        { status: 400, headers: responseHeaders }
      );
    }

    // Determine extension from file name
    const originalName = audioFile.name || 'voiceover.wav';
    const extMatch = originalName.match(/\.([a-zA-Z0-9]+)$/);
    const ext = extMatch ? `.${extMatch[1].toLowerCase()}` : '.wav';

    // Write file to OS temp directory
    const tempDir = os.tmpdir();
    const randomSuffix = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    tempFilePath = path.join(tempDir, `vtttool-audio-${randomSuffix}${ext}`);
    tempOutputPath = path.join(tempDir, `vtttool-output-${randomSuffix}.json`);

    const arrayBuffer = await audioFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await fs.promises.writeFile(tempFilePath, buffer);

    // Resolve script path
    const scriptPath = path.resolve(process.cwd(), 'scripts', 'transcribe.py');
    if (!fs.existsSync(scriptPath)) {
      throw new Error(`Transcribe script not found at ${scriptPath}`);
    }

    // Prepare arguments for scripts/transcribe.py (-u for unbuffered real-time stdout streaming)
    const args = [
      '-u',
      scriptPath,
      '--audio',
      tempFilePath,
      '--model',
      model,
      '--language',
      language,
      '--output',
      tempOutputPath,
      '--level',
      level,
    ];
    if (script && script.trim()) {
      args.push('--script', script.trim());
    }

    const pythonExe = getPythonExe();

    // Stream SSE events with real-time continuous progress
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();

        const child = spawn(/*turbopackIgnore: true*/ pythonExe, args, {
          cwd: process.cwd(),
          env: {
            ...process.env,
            PYTHONIOENCODING: 'utf-8',
            PYTHONUNBUFFERED: '1',
          },
        });

        // Kill process cleanly if client aborts
        req.signal.addEventListener('abort', () => {
          try {
            child.kill();
          } catch {
            // ignore
          }
          controller.close();
        });

        let stdoutBuffer = '';
        let stderrBuffer = '';

        child.stdout.on('data', (chunk) => {
          stdoutBuffer += chunk.toString('utf-8');
          const lines = stdoutBuffer.split('\n');
          stdoutBuffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('PROGRESS:') || trimmed.startsWith('RESULT:') || trimmed.startsWith('ERROR:')) {
              controller.enqueue(encoder.encode(`data: ${trimmed}\n\n`));
            }
          }
        });

        child.stderr.on('data', (chunk) => {
          const str = chunk.toString('utf-8');
          stderrBuffer += str;
          const trimmed = str.trim();
          if (trimmed) {
            controller.enqueue(
              encoder.encode(`data: LOG:${JSON.stringify({ message: trimmed })}\n\n`)
            );
          }
        });

        child.on('close', async (code) => {
          if (stdoutBuffer.trim()) {
            const trimmed = stdoutBuffer.trim();
            if (trimmed.startsWith('PROGRESS:') || trimmed.startsWith('RESULT:') || trimmed.startsWith('ERROR:')) {
              controller.enqueue(encoder.encode(`data: ${trimmed}\n\n`));
            }
          }

          // If result wasn't emitted on stdout, attempt to read from output json file
          if (code === 0 && tempOutputPath && fs.existsSync(tempOutputPath)) {
            try {
              const fileContent = await fs.promises.readFile(tempOutputPath, 'utf-8');
              const parsed = JSON.parse(fileContent);
              controller.enqueue(
                encoder.encode(`data: RESULT:${JSON.stringify(parsed)}\n\n`)
              );
            } catch {
              // ignore
            }
          } else if (code !== 0) {
            controller.enqueue(
              encoder.encode(
                `data: ERROR:${JSON.stringify({ error: `Transcriber exited with code ${code}. ${stderrBuffer.slice(-300)}` })}\n\n`
              )
            );
          }

          // Cleanup temporary files
          if (tempFilePath && fs.existsSync(tempFilePath)) {
            try {
              await fs.promises.unlink(tempFilePath);
            } catch {}
          }
          if (tempOutputPath && fs.existsSync(tempOutputPath)) {
            try {
              await fs.promises.unlink(tempOutputPath);
            } catch {}
          }

          controller.close();
        });

        child.on('error', async (err) => {
          controller.enqueue(
            encoder.encode(
              `data: ERROR:${JSON.stringify({ error: `Failed to spawn Python (${pythonExe}): ${err.message}` })}\n\n`
            )
          );
          if (tempFilePath && fs.existsSync(tempFilePath)) {
            try {
              await fs.promises.unlink(tempFilePath);
            } catch {}
          }
          controller.close();
        });
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        ...responseHeaders,
      },
    });
  } catch (error: any) {
    console.error('API /api/transcribe error:', error);
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        await fs.promises.unlink(tempFilePath);
      } catch {}
    }
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'An unexpected error occurred during transcription.',
      },
      { status: 500, headers: responseHeaders }
    );
  }
}
