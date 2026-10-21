import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

export const maxDuration = 300; // Allow up to 5 minutes for model loading & alignment
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
  let tempScriptPath: string | null = null;
  let tempOutputPath: string | null = null;

  try {
    const formData = await req.formData();
    const audioFile = formData.get('audio') as File | null;
    const script = (formData.get('script') as string) || '';
    const model = (formData.get('model') as string) || 'large-v3-turbo';
    const language = (formData.get('language') as string) || '';
    const level = (formData.get('level') as string) || 'word';

    if (!audioFile) {
      return NextResponse.json(
        { success: false, error: 'No audio file provided for forced alignment.' },
        { status: 400, headers: responseHeaders }
      );
    }

    if (!script || !script.trim()) {
      return NextResponse.json(
        { success: false, error: 'No script text provided for forced alignment.' },
        { status: 400, headers: responseHeaders }
      );
    }

    const originalName = audioFile.name || 'voiceover.wav';
    const extMatch = originalName.match(/\.([a-zA-Z0-9]+)$/);
    const ext = extMatch ? `.${extMatch[1].toLowerCase()}` : '.wav';

    const tempDir = os.tmpdir();
    const randomSuffix = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    tempFilePath = path.join(tempDir, `vtttool-align-audio-${randomSuffix}${ext}`);
    tempScriptPath = path.join(tempDir, `vtttool-align-script-${randomSuffix}.txt`);
    tempOutputPath = path.join(tempDir, `vtttool-align-output-${randomSuffix}.json`);

    const arrayBuffer = await audioFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await fs.promises.writeFile(tempFilePath, buffer);
    await fs.promises.writeFile(tempScriptPath, script, 'utf-8');

    const forcedAlignerPath = path.resolve(process.cwd(), 'scripts', 'forced_aligner.py');
    if (!fs.existsSync(forcedAlignerPath)) {
      throw new Error(`Forced aligner script not found at ${forcedAlignerPath}`);
    }

    const args = [
      forcedAlignerPath,
      '--audio',
      tempFilePath,
      '--script',
      tempScriptPath,
      '--model',
      model,
      '--output',
      tempOutputPath,
      '--level',
      level === 'sentence' ? 'sentence' : 'word',
    ];

    if (language && language.trim()) {
      args.push('--language', language.trim());
    }

    const pythonExe = getPythonExe();

    await new Promise<void>((resolve, reject) => {
      const child = spawn(/*turbopackIgnore: true*/ pythonExe, args, {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8',
        },
      });

      let stderrData = '';
      child.stderr.on('data', (chunk) => {
        stderrData += chunk.toString('utf-8');
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Forced aligner exited with code ${code}. Stderr: ${stderrData}`));
        }
      });

      child.on('error', (err) => {
        reject(new Error(`Failed to spawn Python process (${pythonExe}): ${err.message}`));
      });
    });

    if (!fs.existsSync(tempOutputPath)) {
      throw new Error('Forced alignment completed but no output JSON was generated.');
    }

    const outputContent = await fs.promises.readFile(tempOutputPath, 'utf-8');
    const result = JSON.parse(outputContent);

    return NextResponse.json(result, { status: 200, headers: responseHeaders });
  } catch (error: any) {
    console.error('Error during forced alignment:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Forced alignment failed.' },
      { status: 500, headers: responseHeaders }
    );
  } finally {
    // Cleanup temporary files
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        await fs.promises.unlink(tempFilePath);
      } catch {}
    }
    if (tempScriptPath && fs.existsSync(tempScriptPath)) {
      try {
        await fs.promises.unlink(tempScriptPath);
      } catch {}
    }
    if (tempOutputPath && fs.existsSync(tempOutputPath)) {
      try {
        await fs.promises.unlink(tempOutputPath);
      } catch {}
    }
  }
}
