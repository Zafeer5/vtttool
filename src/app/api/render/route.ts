import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRenderJob, listRenderJobs, clearFinishedRenderJobs, deleteRenderJob } from '@/lib/render-jobs';

export const maxDuration = 300; // Up to 5 minutes maximum timeout
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  let tempDirPath: string | null = null;

  try {
    const formData = await req.formData();
    const durationsRaw = formData.get('durations') as string | null;
    const totalDurationRaw = formData.get('totalDuration') as string | null;
    const resolution = (formData.get('resolution') as string) || '1080p';
    const audioFile = formData.get('audio') as File | null;
    const motionRaw = formData.get('motion') as string | null;
    let motionData: any = null;
    if (motionRaw) {
      try {
        motionData = JSON.parse(motionRaw);
      } catch (e) {
        console.warn('Could not parse motion settings:', e);
      }
    }

    if (!durationsRaw) {
      return NextResponse.json(
        { success: false, error: 'No durations provided.' },
        { status: 400 }
      );
    }

    const durations: number[] = JSON.parse(durationsRaw);
    let totalDuration = totalDurationRaw ? parseFloat(totalDurationRaw) : 0;
    if (!totalDuration || isNaN(totalDuration)) {
      totalDuration = durations.reduce((a, b) => a + b, 0);
    }

    // Get all image entries
    const imageFiles: File[] = [];
    const allEntries = Array.from(formData.entries());
    for (const [key, value] of allEntries) {
      if ((key === 'images' || key.startsWith('image')) && value instanceof File) {
        imageFiles.push(value);
      }
    }

    if (imageFiles.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No images provided for video rendering.' },
        { status: 400 }
      );
    }
    if (imageFiles.length !== durations.length) {
      return NextResponse.json(
        { success: false, error: 'The image count does not match the timeline clip count.' },
        { status: 400 }
      );
    }

    if (imageFiles.length > 1000) {
      return NextResponse.json(
        { success: false, error: 'Maximum 1000 images allowed per render project.' },
        { status: 400 }
      );
    }

    // Create unique temp directory
    const tempDir = os.tmpdir();
    const randomSuffix = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    tempDirPath = path.join(tempDir, `vtttool-render-${randomSuffix}`);
    await fs.promises.mkdir(tempDirPath, { recursive: true });

    // Save image files with bounded concurrency (4 parallel workers) to prevent memory exhaustion
    const numSlides = Math.min(imageFiles.length, durations.length);
    const slideItems: { image: string; duration: number }[] = new Array(numSlides);
    const allowedImageExts = new Set(['jpg', 'jpeg', 'png', 'webp', 'bmp']);

    const imageIndices = Array.from({ length: numSlides }, (_, i) => i);
    let currentIdx = 0;
    const workerCount = Math.min(4, numSlides);

    const imageWorkers = Array.from({ length: workerCount }, async () => {
      while (currentIdx < numSlides) {
        const i = currentIdx++;
        const imgFile = imageFiles[i];
        const rawExt = imgFile.name.match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase() || 'jpg';
        const ext = allowedImageExts.has(rawExt) ? `.${rawExt}` : '.jpg';
        const imgPath = path.join(tempDirPath!, `input_${String(i).padStart(4, '0')}${ext}`);
        const buffer = Buffer.from(await imgFile.arrayBuffer());
        await fs.promises.writeFile(imgPath, buffer);
        slideItems[i] = {
          image: imgPath,
          duration: durations[i],
        };
      }
    });

    // Save audio file if provided
    let audioPath: string | null = null;
    let writeAudioPromise: Promise<void> | null = null;
    if (audioFile && audioFile.size > 0) {
      const audioExtMatch = audioFile.name.match(/\.([a-zA-Z0-9]+)$/);
      const rawAudioExt = audioExtMatch ? audioExtMatch[1].toLowerCase() : 'wav';
      const allowedAudioExts = new Set(['wav', 'mp3', 'm4a', 'aac', 'ogg', 'flac']);
      const audioExt = allowedAudioExts.has(rawAudioExt) ? `.${rawAudioExt}` : '.wav';
      audioPath = path.join(tempDirPath, `voiceover${audioExt}`);
      writeAudioPromise = (async () => {
        const audioBuffer = Buffer.from(await audioFile.arrayBuffer());
        await fs.promises.writeFile(audioPath!, audioBuffer);
      })();
    }

    // Save logo watermark file if provided
    const logoFile = formData.get('logo') as File | null;
    const logoSettingsRaw = formData.get('logoSettings') as string | null;
    let logoData: any = null;
    if (logoSettingsRaw) {
      try {
        logoData = JSON.parse(logoSettingsRaw);
      } catch (e) {
        console.warn('Could not parse logo settings:', e);
      }
    }

    let logoPath: string | null = null;
    let writeLogoPromise: Promise<void> | null = null;
    if (logoFile && logoFile.size > 0) {
      const logoExtMatch = logoFile.name.match(/\.([a-zA-Z0-9]+)$/);
      const rawLogoExt = logoExtMatch ? logoExtMatch[1].toLowerCase() : 'png';
      const logoExt = allowedImageExts.has(rawLogoExt) ? `.${rawLogoExt}` : '.png';
      logoPath = path.join(tempDirPath, `watermark_logo${logoExt}`);
      if (!logoData) {
        logoData = { enabled: true };
      }
      logoData.path = logoPath;
      logoData.enabled = true;
      writeLogoPromise = (async () => {
        const logoBuffer = Buffer.from(await logoFile.arrayBuffer());
        await fs.promises.writeFile(logoPath!, logoBuffer);
      })();
    }

    await Promise.all([
      Promise.all(imageWorkers),
      ...(writeAudioPromise ? [writeAudioPromise] : []),
      ...(writeLogoPromise ? [writeLogoPromise] : []),
    ]);

    const exportMode = formData.get('exportMode') === 'clips_zip' ? 'clips_zip' : 'single';
    const isZip = exportMode === 'clips_zip';
    const slideTimingsRaw = formData.get('slideTimings') as string | null;
    let slideTimings: any = null;
    if (slideTimingsRaw) {
      try {
        slideTimings = JSON.parse(slideTimingsRaw);
      } catch (e) {
        console.warn('Could not parse slideTimings:', e);
      }
    }
    if (!Array.isArray(slideTimings) || slideTimings.length !== durations.length) {
      return NextResponse.json(
        { success: false, error: 'Timeline timings are missing or do not match the clip count.' },
        { status: 400 }
      );
    }

    // Create manifest.json
    const manifestPath = path.join(tempDirPath, 'manifest.json');
    const outputFileNameOnDisk = isZip ? 'output.zip' : 'output.mp4';
    const outputFilePath = path.join(/*turbopackIgnore: true*/ tempDirPath, outputFileNameOnDisk);

    const manifestData: any = {
      slides: slideItems,
      slideTimings: slideTimings || undefined,
      audio: audioPath,
      resolution: resolution,
      totalDuration: totalDuration,
      exportMode: exportMode,
    };
    if (motionData) {
      manifestData.motion = motionData;
    }
    if (logoData && logoData.enabled && logoPath) {
      manifestData.logo = logoData;
    }
    await fs.promises.writeFile(manifestPath, JSON.stringify(manifestData, null, 2), 'utf-8');

    const scriptPath = path.resolve(process.cwd(), 'vtt_slideshow_generator.py');
    const bundledGeneratorExe = process.env.VTT_RENDERER_EXE;
    let pythonExe: string;
    const args: string[] = [];
    if (fs.existsSync(scriptPath)) {
      pythonExe = process.platform === 'win32' ? 'python' : 'python3';
      args.push(scriptPath);
    } else if (bundledGeneratorExe && fs.existsSync(bundledGeneratorExe)) {
      pythonExe = bundledGeneratorExe;
    } else {
      throw new Error(`Generator script not found at ${scriptPath}`);
    }
    args.push(
      '--manifest',
      manifestPath,
      '--output',
      outputFilePath,
      '--export-mode',
      exportMode,
      '--resolution',
      resolution,
      '--total-duration',
      String(totalDuration),
    );
    if (slideTimings) {
      args.push('--slide-timings', JSON.stringify(slideTimings));
    }
    if (audioPath) {
      args.push('--audio', audioPath);
    }
    if (motionData) {
      args.push('--motion', JSON.stringify(motionData));
    }
    if (logoData && logoData.enabled && logoPath) {
      args.push('--logo-settings', JSON.stringify(logoData));
    }


    const rawDestinationFolder = formData.get('destinationFolder') as string | null;
    let safeDestinationFolder: string | null = null;
    if (rawDestinationFolder && typeof rawDestinationFolder === 'string') {
      try {
        const resolved = path.resolve(rawDestinationFolder);
        if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
          safeDestinationFolder = resolved;
        }
      } catch {}
    }
    const rawOutputFileName = formData.get('outputFileName') as string | null;
    const safeOutputFileName = rawOutputFileName
      ? path.basename(rawOutputFileName).replace(/[^a-zA-Z0-9._\-\s]/g, '_')
      : null;

    const job = await createRenderJob({
      tempDirPath,
      outputFilePath,
      pythonExe,
      args,
      cwd: process.cwd(),
      duration: totalDuration,
      slideCount: numSlides,
      resolution,
      firstImagePath: slideItems[0]?.image || null,
      isZip,
      exportMode: exportMode as 'single' | 'clips_zip',
      destinationFolder: safeDestinationFolder,
      outputFileName: safeOutputFileName,
    });
    tempDirPath = null;

    return NextResponse.json({ success: true, job }, { status: 202 });
  } catch (error: any) {
    console.error('API /api/render error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'An unexpected error occurred during native rendering.',
      },
      { status: 500 }
    );
  } finally {
    // Clean up temporary rendering folder
    if (tempDirPath && fs.existsSync(tempDirPath)) {
      try {
        await fs.promises.rm(tempDirPath, { recursive: true, force: true });
      } catch (e) {
        console.warn('Could not clean up temp render directory:', e);
      }
    }
  }
}

export async function GET() {
  try {
    const jobs = await listRenderJobs();
    return NextResponse.json({ success: true, jobs }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error: any) {
    console.error('Failed to list render jobs:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to list render jobs.' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const clear = url.searchParams.get('clear');
    const id = url.searchParams.get('id');

    if (clear === 'finished' || clear === 'all') {
      const clearedCount = await clearFinishedRenderJobs();
      return NextResponse.json({ success: true, clearedCount });
    }

    if (id) {
      const deleted = await deleteRenderJob(id);
      return NextResponse.json({ success: true, deleted });
    }

    return NextResponse.json(
      { success: false, error: 'Specify ?clear=finished or ?id=<jobId>' },
      { status: 400 }
    );
  } catch (error: any) {
    console.error('API DELETE /api/render error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to delete render jobs.' },
      { status: 500 }
    );
  }
}
