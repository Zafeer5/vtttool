import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import {
  DEFAULT_ZOOM_INTENSITY,
  SyncMatch,
  RenderProgress,
  MotionSettings,
  LogoSettings,
  ExportMode,
} from './types';
import {
  getZoomScaleForFrame,
  withClipZoomMetadata,
} from './motion';
import { SimpleZipBuilder } from './zip-builder';
import {
  normalizeImageToCanvas,
  normalizeImagesInParallel,
  NormalizedImageResult,
  VideoResolution,
  RESOLUTION_PRESETS,
} from './image-helper';

export interface RenderOptions {
  onProgress?: (progress: RenderProgress) => void;
  width?: number;
  height?: number;
  fps?: number;
  resolution?: VideoResolution;
  engine?: 'native' | 'ffmpeg' | 'webcodecs' | 'compatibility';
  voiceoverFile?: File | Blob;
  motionSettings?: MotionSettings;
  logoSettings?: LogoSettings;
  signal?: AbortSignal;
  totalDuration?: number;
  destinationFolder?: string;
  outputFileName?: string;
  exportMode?: ExportMode;
  slideTimings?: {
    startTime: number;
    endTime: number;
    duration: number;
    zoomSeed?: number;
    zoomDirection?: 'in' | 'out';
  }[];
}

type NativeRenderError = Error & {
  isNativeServerError?: boolean;
  nativeFallbackEligible?: boolean;
};

let ffmpegInstance: FFmpeg | null = null;
let isFFmpegLoaded = false;
let isMultiThreaded = false;

/**
 * Checks whether the current loaded FFmpeg instance is multi-threaded.
 */
export function isFFmpegMultiThreaded(): boolean {
  return isMultiThreaded;
}

/**
 * Executes a promise with an automatic timeout to prevent infinite hangs.
 */
async function promiseWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Initializes and loads FFmpeg.wasm instance.
 * Loads @ffmpeg/core-mt (multi-threaded) when SharedArrayBuffer is available,
 * with graceful fallback to single-threaded core.
 * Protected with a 12s timeout to ensure it never freezes the browser.
 */
export async function getFFmpeg(onLog?: (msg: string) => void): Promise<FFmpeg> {
  if (ffmpegInstance && isFFmpegLoaded) {
    return ffmpegInstance;
  }

  const ffmpeg = new FFmpeg();

  ffmpeg.on('log', ({ message }) => {
    if (onLog) onLog(message);
  });

  const supportsMultiThread = typeof SharedArrayBuffer !== 'undefined';
  const classWorkerURL = `${window.location.origin}/ffmpeg/ffmpeg-worker-esm.js`;

  if (supportsMultiThread) {
    try {
      const mtBase = `${window.location.origin}/ffmpeg-mt`;
      await promiseWithTimeout(
        ffmpeg.load({
          classWorkerURL,
          coreURL: `${mtBase}/ffmpeg-core.js`,
          wasmURL: `${mtBase}/ffmpeg-core.wasm`,
          workerURL: `${mtBase}/ffmpeg-core.worker.js`,
        }),
        10000,
        'Multi-threaded FFmpeg core loading timed out'
      );
      isFFmpegLoaded = true;
      isMultiThreaded = true;
      ffmpegInstance = ffmpeg;
      if (onLog) onLog('[FFmpeg] Successfully loaded multi-threaded core (@ffmpeg/core-mt)');
      return ffmpeg;
    } catch (mtErr) {
      console.warn('Could not load multi-threaded FFmpeg core, falling back to single-threaded core...', mtErr);
    }
  }

  // Fallback to single-threaded core with timeout protection
  const baseURL = `${window.location.origin}/ffmpeg`;
  await promiseWithTimeout(
    ffmpeg.load({
      classWorkerURL,
      coreURL: `${baseURL}/ffmpeg-core.js`,
      wasmURL: `${baseURL}/ffmpeg-core.wasm`,
    }),
    12000,
    'FFmpeg single-threaded core loading timed out'
  );
  isFFmpegLoaded = true;
  isMultiThreaded = false;
  ffmpegInstance = ffmpeg;
  if (onLog) onLog('[FFmpeg] Loaded single-threaded core (@ffmpeg/core)');
  return ffmpeg;
}

/**
 * Real-time compatibility video generator using HTML5 Canvas & MediaRecorder.
 * Used only as a fallback if both FFmpeg and WebCodecs are unavailable.
 * Note: Wall-clock duration equals video duration.
 */
export async function renderWithCanvasMediaRecorder(
  matches: SyncMatch[],
  options: RenderOptions,
  logs: string[]
): Promise<Blob> {
  const { onProgress, width = 1280, height = 720, fps = 30 } = options;

  logs.push('[Compatibility Mode] Using HTML5 Canvas MediaRecorder (export time equals video duration)...');
  onProgress?.({
    stage: 'encoding',
    percentage: 10,
    message: 'Rendering video frames with MediaRecorder (Compatibility Mode)...',
    logs,
  });

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get Canvas 2D context');

  // Pre-load normalized images
  const normalizedImages: HTMLImageElement[] = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    if (m.image) {
      const normalized = await normalizeImageToCanvas(m.image.previewUrl, width, height);
      const img = new Image();
      const loadedPromise = new Promise((resolve) => {
        img.onload = resolve;
      });
      img.src = URL.createObjectURL(normalized.blob);
      await loadedPromise;
      normalizedImages.push(img);
    }
  }

  const stream = canvas.captureStream(fps);

  let mimeType = 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"';
  if (!MediaRecorder.isTypeSupported(mimeType)) {
    mimeType = 'video/mp4';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm; codecs=vp9';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm';
      }
    }
  }

  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 4000000,
  });

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const recordingPromise = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      resolve(blob);
    };
    recorder.onerror = (e) => reject(e);
  });

  recorder.start();

  const totalDuration = matches.reduce((acc, m) => acc + m.duration, 0);
  let elapsed = 0;

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const img = normalizedImages[i];
    const frameCount = Math.max(1, Math.round(m.duration * fps));
    const motion = options.motionSettings;

    const slideProgress = Math.round(((elapsed + m.duration) / totalDuration) * 85);
    onProgress?.({
      stage: 'encoding',
      percentage: Math.min(95, Math.max(10, slideProgress)),
      message: `Recording slide ${i + 1} of ${matches.length} (${m.duration.toFixed(1)}s)...`,
      logs,
    });

    for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
      ctx.clearRect(0, 0, width, height);
      if (img) {
        const scale =
          motion?.zoomEnabled
            ? getZoomScaleForFrame(
                frameIndex,
                frameCount,
                m.zoomDirection || 'in',
                motion.zoomIntensity ?? DEFAULT_ZOOM_INTENSITY
              )
            : 1;
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.translate(width / 2, height / 2);
        ctx.scale(scale, scale);
        ctx.drawImage(img, -width / 2, -height / 2, width, height);
        ctx.restore();
      }
      await new Promise((resolve) => setTimeout(resolve, 1000 / fps));
    }
    elapsed += m.duration;
  }

  onProgress?.({
    stage: 'finalizing',
    percentage: 96,
    message: 'Finalizing MediaRecorder container...',
    logs,
  });

  recorder.stop();
  const outputBlob = await recordingPromise;
  return outputBlob;
}

/**
 * Fast video generator using WebCodecs VideoEncoder API + mp4-muxer.
 * Encodes frames without wall-clock waiting.
 */
export async function renderWithWebCodecsVideoEncoder(
  matches: SyncMatch[],
  options: RenderOptions,
  logs: string[]
): Promise<Blob> {
  const { onProgress, width = 1280, height = 720, fps = 30 } = options;

  logs.push('[WebCodecs] Initializing hardware-accelerated VideoEncoder...');
  onProgress?.({
    stage: 'encoding',
    percentage: 15,
    message: 'Initializing WebCodecs VideoEncoder...',
    logs,
  });

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: {
      codec: 'avc',
      width,
      height,
    },
    fastStart: 'in-memory',
  });

  let encoderError: Error | null = null;

  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      muxer.addVideoChunk(chunk, meta);
    },
    error: (e) => {
      encoderError = e instanceof Error ? e : new Error(String(e));
      logs.push(`[WebCodecs Error] ${encoderError.message}`);
    },
  });

  await encoder.configure({
    codec: 'avc1.42001f',
    width,
    height,
    bitrate: 1_800_000,
    framerate: fps,
  });

  // Pre-decode normalized images to ImageBitmap in parallel using Web Workers
  logs.push(`[WebCodecs] Decoding ${matches.length} slides to ImageBitmaps in parallel...`);
  const itemsToNormalize = matches.map((m) => ({
    previewUrl: m.image?.previewUrl || '',
    file: m.image?.file,
    id: m.image?.id,
    name: m.image?.name,
    duration: m.duration,
  }));

  const normalizedResults = await normalizeImagesInParallel(itemsToNormalize, width, height);
  const bitmaps: (ImageBitmap | null)[] = await Promise.all(
    normalizedResults.map(async ({ result }) => {
      try {
        return await createImageBitmap(result.blob);
      } catch {
        return null;
      }
    })
  );

  logs.push('[WebCodecs] Encoding frames without wall-clock waiting...');
  let totalFramesEncoded = 0;

  const motion = options.motionSettings;
  const motionActive = !!(motion && (motion.enabled || motion.zoomEnabled));
  let offscreenCanvas: OffscreenCanvas | null = null;
  let offscreenCtx: OffscreenCanvasRenderingContext2D | null = null;
  if (motionActive && typeof OffscreenCanvas !== 'undefined') {
    offscreenCanvas = new OffscreenCanvas(width, height);
    offscreenCtx = offscreenCanvas.getContext('2d');
    if (offscreenCtx) {
      // 4. High-quality image scaling: bicubic/lanczos interpolation for buttery zoom
      offscreenCtx.imageSmoothingEnabled = true;
      offscreenCtx.imageSmoothingQuality = 'high';
    }
  }

  // Center-center transform helper to guarantee zero sub-pixel boundary jitter
  const drawCenteredScaledBitmap = (
    ctx: OffscreenCanvasRenderingContext2D,
    bmp: CanvasImageSource,
    s: number,
    alpha = 1.0
  ) => {
    ctx.save();
    ctx.globalAlpha = alpha;
    // 2. Fixed center-center origin: (width/2, height/2)
    const cx = width / 2;
    const cy = height / 2;
    ctx.translate(cx, cy);
    ctx.scale(s, s);
    // Draw centered relative to origin
    ctx.drawImage(bmp, -cx, -cy, width, height);
    ctx.restore();
  };

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const bitmap = bitmaps[i];
    if (!bitmap) continue;

    const startFrame = Math.round(m.startTime * fps);
    const endFrame = Math.max(startFrame + 1, Math.round(m.endTime * fps));
    const frameCount = endFrame - startFrame;
    const startUs = Math.round((startFrame * 1_000_000) / fps);
    let isSlideFirstFrame = true;

    for (let frameNumber = startFrame; frameNumber < endFrame; frameNumber++) {
      if (encoderError) throw encoderError;
      const timeUs = Math.round((frameNumber * 1_000_000) / fps);
      const exactFrameDurationUs =
        Math.round(((frameNumber + 1) * 1_000_000) / fps) - timeUs;

      if (encoder.encodeQueueSize > 20) {
        await new Promise((r) => setTimeout(r, 0));
      }

      let frameSource: CanvasImageSource = bitmap;

      if (motionActive && offscreenCanvas && offscreenCtx) {
        let scale = 1.0;
        if (motion.zoomEnabled) {
          scale = getZoomScaleForFrame(
            frameNumber - startFrame,
            frameCount,
            m.zoomDirection || (motion.zoomDirection === 'out' ? 'out' : 'in'),
            motion.zoomIntensity ?? DEFAULT_ZOOM_INTENSITY
          );
        }

        offscreenCtx.fillStyle = '#0a0d14';
        offscreenCtx.fillRect(0, 0, width, height);

        const transDurSec = Math.min(
          motion.transitionDuration || 0.6,
          m.duration * 0.45
        );
        const transDurUs = transDurSec * 1_000_000;
        const inTransition =
          i > 0 &&
          motion.enabled &&
          motion.transitionEnabled &&
          timeUs - startUs < transDurUs &&
          bitmaps[i - 1];

        if (inTransition && bitmaps[i - 1]) {
          const tProg = Math.max(0, Math.min(1, (timeUs - startUs) / transDurUs));
          const prevBmp = bitmaps[i - 1]!;
          const tType = motion.transitionType || 'dissolve';

          if (tType === 'dissolve') {
            offscreenCtx.globalAlpha = 1.0;
            offscreenCtx.drawImage(prevBmp, 0, 0, width, height);
            drawCenteredScaledBitmap(offscreenCtx, bitmap, scale, tProg);
          } else if (tType === 'fadein') {
            drawCenteredScaledBitmap(offscreenCtx, bitmap, scale, tProg);
          } else if (tType === 'fadeout') {
            if (tProg < 0.5) {
              offscreenCtx.globalAlpha = 1 - tProg * 2;
              offscreenCtx.drawImage(prevBmp, 0, 0, width, height);
              offscreenCtx.globalAlpha = 1.0;
            } else {
              drawCenteredScaledBitmap(offscreenCtx, bitmap, scale, (tProg - 0.5) * 2);
            }
          } else if (tType === 'wipe-left' || (tType === 'wipe-random' && i % 2 === 0)) {
            offscreenCtx.drawImage(prevBmp, 0, 0, width, height);
            offscreenCtx.save();
            offscreenCtx.beginPath();
            offscreenCtx.rect((1 - tProg) * width, 0, tProg * width, height);
            offscreenCtx.clip();
            drawCenteredScaledBitmap(offscreenCtx, bitmap, scale, 1.0);
            offscreenCtx.restore();
          } else {
            offscreenCtx.drawImage(prevBmp, 0, 0, width, height);
            offscreenCtx.save();
            offscreenCtx.beginPath();
            offscreenCtx.rect(0, 0, tProg * width, height);
            offscreenCtx.clip();
            drawCenteredScaledBitmap(offscreenCtx, bitmap, scale, 1.0);
            offscreenCtx.restore();
          }
        } else {
          drawCenteredScaledBitmap(offscreenCtx, bitmap, scale, 1.0);
        }

        frameSource = offscreenCanvas;
      }

      const frame = new VideoFrame(frameSource, {
        timestamp: timeUs,
        duration: exactFrameDurationUs,
      });

      encoder.encode(frame, { keyFrame: isSlideFirstFrame });
      frame.close();
      isSlideFirstFrame = false;
      totalFramesEncoded++;
    }

    const pct = Math.round(20 + ((i + 1) / matches.length) * 70);
    onProgress?.({
      stage: 'encoding',
      percentage: pct,
      message: `Encoded slide ${i + 1} of ${matches.length} (${totalFramesEncoded} frames)...`,
      logs,
    });
  }

  for (const b of bitmaps) {
    b?.close();
  }

  logs.push('[WebCodecs] Flushing video encoder...');
  await encoder.flush();
  encoder.close();

  logs.push('[WebCodecs] Finalizing MP4 muxer...');
  muxer.finalize();

  const { buffer } = muxer.target;
  const outputBlob = new Blob([buffer], { type: 'video/mp4' });

  onProgress?.({
    stage: 'completed',
    percentage: 100,
    message: 'Video rendering completed with WebCodecs!',
    logs,
    outputBlob,
    outputSize: outputBlob.size,
  });

  return outputBlob;
}

/**
 * Fallback router: selects WebCodecs VideoEncoder if supported,
 * falling back to Canvas MediaRecorder in compatibility mode.
 */
async function renderCanvasFallback(
  matches: SyncMatch[],
  options: RenderOptions,
  logs: string[]
): Promise<Blob> {
  const supportsWebCodecs =
    typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';

  if (supportsWebCodecs) {
    try {
      return await renderWithWebCodecsVideoEncoder(matches, options, logs);
    } catch (wcErr) {
      logs.push(`[WebCodecs Error] ${wcErr instanceof Error ? wcErr.message : String(wcErr)}. Falling back to MediaRecorder compatibility mode...`);
    }
  }

  return await renderWithCanvasMediaRecorder(matches, options, logs);
}

async function createFallbackCanvasBlob(
  slideNum: number,
  textSnippet: string,
  width = 1280,
  height = 720
): Promise<Blob> {
  if (typeof document === 'undefined') {
    return new Blob([], { type: 'image/jpeg' });
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, '#FFFFFF');
    grad.addColorStop(1, '#FFF7ED');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = '#EA580C';
    ctx.lineWidth = 8;
    ctx.strokeRect(24, 24, width - 48, height - 48);

    ctx.fillStyle = '#EA580C';
    ctx.font = 'bold 44px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Slide ${slideNum}`, width / 2, height / 2 - 30);

    ctx.fillStyle = '#0F172A';
    ctx.font = '22px sans-serif';
    const cleanSnippet = textSnippet.length > 70 ? textSnippet.substring(0, 67) + '...' : textSnippet;
    ctx.fillText(cleanSnippet, width / 2, height / 2 + 30);
  }
  return new Promise<Blob>((resolve) => {
    canvas.toBlob((b) => resolve(b || new Blob()), 'image/jpeg', 0.95);
  });
}

/**
 * Ultra-fast video generator using the local Native FFmpeg Engine via /api/render.
 * Bypasses slow browser WebAssembly to compile videos in 5 to 15 seconds.
 */
export async function renderWithNativeServer(
  matches: SyncMatch[],
  options: RenderOptions,
  logs: string[]
): Promise<Blob> {
  const { onProgress, resolution = '720p', signal } = options;

  if (signal?.aborted) {
    throw new Error('Compilation cancelled by user.');
  }

  logs.push('[Native Engine] Initializing high-speed native FFmpeg compilation via local server...');
  const isZip = options.exportMode === 'clips_zip';
  const formData = new FormData();
  formData.append('exportMode', options.exportMode || 'single');
  const slideTimings = matches.map((m) => ({
    startTime: m.startTime,
    endTime: m.endTime,
    duration: m.duration,
    zoomSeed: m.zoomSeed,
    zoomDirection: m.zoomDirection,
  }));
  formData.append('slideTimings', JSON.stringify(slideTimings));

  if (isZip) {
    logs.push(`[Native Engine] Export Mode: Clips ZIP Archive (${matches.length} individual video chunks with synced timeline timing)...`);
  } else {
    logs.push(`[Native Engine] Export Mode: Single Unified Video (Continuous synchronized MP4 video)...`);
  }

  const durations = matches.map((m) => m.duration);
  const calculatedTotal =
    options.totalDuration ||
    (matches.length > 0
      ? matches[matches.length - 1].endTime
      : durations.reduce((a, b) => a + b, 0));

  formData.append('durations', JSON.stringify(durations));
  formData.append('totalDuration', String(calculatedTotal));
  formData.append('resolution', resolution);
  if (options.destinationFolder) {
    formData.append('destinationFolder', options.destinationFolder);
  }
  if (options.outputFileName) {
    formData.append('outputFileName', options.outputFileName);
  }

  if (options.motionSettings) {
    formData.append('motion', JSON.stringify(options.motionSettings));
    logs.push(
      `[Native Engine] Zoom ${options.motionSettings.zoomEnabled ? 'enabled' : 'disabled'} (${options.motionSettings.zoomIntensity}%), transitions ${options.motionSettings.enabled && options.motionSettings.transitionEnabled ? 'enabled' : 'disabled'}.`
    );
  }

  if (options.voiceoverFile) {
    formData.append('audio', options.voiceoverFile);
    logs.push('[Native Engine] Attached voiceover audio track.');
  }

  // Handle Logo watermark overlay
  if (options.logoSettings && options.logoSettings.enabled) {
    let logoBlob: Blob | File | null = options.logoSettings.file || null;
    if (!logoBlob && options.logoSettings.previewUrl) {
      try {
        const resp = await fetch(options.logoSettings.previewUrl, { signal });
        logoBlob = await resp.blob();
      } catch (err) {
        console.warn('Could not fetch logo preview blob:', err);
      }
    }

    if (logoBlob) {
      formData.append('logo', logoBlob, options.logoSettings.name || 'watermark_logo.png');
      formData.append(
        'logoSettings',
        JSON.stringify({
          enabled: true,
          position: options.logoSettings.position || 'top-right',
          scale: options.logoSettings.scale || 15,
          opacity: options.logoSettings.opacity || 0.9,
          margin: options.logoSettings.margin || 24,
          customX: options.logoSettings.customX ?? 50,
          customY: options.logoSettings.customY ?? 50,
        })
      );
      logs.push(
        `[Native Engine] Attached Logo Watermark: ${options.logoSettings.name || 'logo'} (Position: ${options.logoSettings.position}, Scale: ${options.logoSettings.scale}%)`
      );
    }
  }

  const targetPreset = RESOLUTION_PRESETS[resolution];
  const targetW = options.width || targetPreset.width;
  const targetH = options.height || targetPreset.height;

  // Fast zero-copy image attachment: Send original file buffers directly to native server
  // Avoids slow browser-side canvas rendering loops and shrinks startup latency to under 100ms
  onProgress?.({
    stage: 'preparing',
    percentage: 3,
    message: `Fast-preparing ${matches.length} slides for native render...`,
    logs,
  });

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const filename = m.image?.name || `slide_${i + 1}.jpg`;
    if (m.image && m.image.file) {
      formData.append('images', m.image.file, filename);
    } else if (m.image && m.image.previewUrl) {
      try {
        const resp = await fetch(m.image.previewUrl, { signal });
        const blob = await resp.blob();
        formData.append('images', blob, filename);
      } catch {
        const fallbackBlob = await createFallbackCanvasBlob(i + 1, m.paragraph?.text || `Slide ${i + 1}`, targetW, targetH);
        formData.append('images', fallbackBlob, `slide_${i + 1}_fallback.jpg`);
      }
    } else {
      const fallbackBlob = await createFallbackCanvasBlob(i + 1, m.paragraph?.text || `Slide ${i + 1}`, targetW, targetH);
      formData.append('images', fallbackBlob, `slide_${i + 1}_fallback.jpg`);
    }
  }

  logs.push('[Native Engine] Dispatching payload to Native FFmpeg backend...');
  onProgress?.({
    stage: 'encoding',
    percentage: 5,
    message: 'Uploading prepared media to native render server...',
    logs,
  });

  const startTime = Date.now();
  let jobId: string | null = null;
  let jobCompleted = false;
  let nativeServerActive = false;
  try {
    let response: Response;
    try {
      response = await fetch('/api/render', {
        method: 'POST',
        body: formData,
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      const fallbackError = error instanceof Error ? error : new Error(String(error));
      (fallbackError as NativeRenderError).nativeFallbackEligible = true;
      throw fallbackError;
    }

    if (!response.ok) {
      let errorDetail = `Native render failed (HTTP ${response.status})`;
      try {
        const errJson = await response.json();
        if (errJson.error) errorDetail = errJson.error;
      } catch {}
      const responseError = new Error(errorDetail) as NativeRenderError;
      if (response.status === 404) {
        responseError.nativeFallbackEligible = true;
      } else {
        nativeServerActive = true;
        responseError.isNativeServerError = true;
      }
      throw responseError;
    }

    nativeServerActive = true;
    const accepted = await response.json();
    jobId = accepted.job?.id;
    if (!jobId) {
      throw new Error('Render server did not return a background job ID.');
    }

    logs.push(`[Native Engine] Background render job ${jobId} accepted.`);
    let job = accepted.job;
    let highestProgress = typeof job.progress === 'number' ? job.progress : 0;

    onProgress?.({
      stage: job.status === 'queued' ? 'queued' : 'preparing',
      percentage: highestProgress,
      message: job.message || 'Render accepted; starting server-side encoder...',
      logs: [...logs, ...(Array.isArray(job.logs) ? job.logs : [])],
      stats: job.stats,
      jobId,
    });

    let lastProgressUpdateTime = 0;

    // Use Server-Sent Events (SSE) to receive real-time updates from backend without UI polling bottleneck
    job = await new Promise<any>((resolve, reject) => {
      let resolved = false;
      let eventSource: EventSource | null = null;
      let fallbackPollTimer: NodeJS.Timeout | null = null;

      const cleanup = () => {
        if (eventSource) {
          eventSource.close();
          eventSource = null;
        }
        if (fallbackPollTimer) {
          clearInterval(fallbackPollTimer);
          fallbackPollTimer = null;
        }
      };

      const handleJobUpdate = (currentJob: any) => {
        if (resolved) return;
        const rawProgress = typeof currentJob.progress === 'number' ? currentJob.progress : 0;
        // Keep progress monotonic within this job: strictly moving forward, without artificial base offset
        const mappedProgress = Math.min(99, Math.max(highestProgress, Math.round(rawProgress)));
        highestProgress = mappedProgress;
        const isTerminal =
          currentJob.status === 'completed' ||
          currentJob.status === 'failed' ||
          currentJob.status === 'cancelled' ||
          currentJob.status === 'interrupted';

        const now = performance.now();
        if (now - lastProgressUpdateTime > 100 || isTerminal || mappedProgress >= 95) {
          lastProgressUpdateTime = now;
          const jobLogs = Array.isArray(currentJob.logs) ? currentJob.logs : [];
          const currentStage =
            currentJob.status === 'queued'
              ? 'queued'
              : mappedProgress >= 96
              ? 'finalizing'
              : currentJob.status === 'running'
              ? 'encoding'
              : 'preparing';

          onProgress?.({
            stage: currentStage,
            percentage: mappedProgress,
            message: currentJob.message || 'Compiling synchronized video...',
            logs: [...logs, ...jobLogs.slice(-40)],
            stats: currentJob.stats,
            jobId,
          });
        }

        if (currentJob.status === 'completed') {
          resolved = true;
          cleanup();
          resolve(currentJob);
        } else if (currentJob.status === 'failed') {
          resolved = true;
          cleanup();
          reject(new Error(currentJob.error || 'Background render failed.'));
        } else if (currentJob.status === 'cancelled') {
          resolved = true;
          cleanup();
          reject(new Error('Compilation was cancelled.'));
        }
      };

      if (signal?.aborted) {
        cleanup();
        reject(new Error('Compilation cancelled by user.'));
        return;
      }

      signal?.addEventListener('abort', () => {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(new Error('Compilation cancelled by user.'));
        }
      });

      // 1. Primary: Server-Sent Events (SSE) stream for zero-latency, push-based progress
      if (typeof EventSource !== 'undefined') {
        try {
          eventSource = new EventSource(`/api/render/${jobId}/events`);
          eventSource.onmessage = (event) => {
            try {
              const updatedJob = JSON.parse(event.data);
              handleJobUpdate(updatedJob);
            } catch (err) {
              console.warn('Could not parse SSE message:', err);
            }
          };
          eventSource.onerror = () => {
            // If SSE connection closes or errors, the throttled fallback poll continues seamlessly
            if (eventSource) {
              eventSource.close();
              eventSource = null;
            }
          };
        } catch (e) {
          console.warn('Could not initialize EventSource, using throttled polling fallback:', e);
        }
      }

      // 2. Throttled fallback poller (every 1.5s) to guarantee resilience if SSE is blocked
      fallbackPollTimer = setInterval(async () => {
        if (resolved) return;
        try {
          const statusResp = await fetch(`/api/render/${jobId}`, {
            cache: 'no-store',
            signal,
          });
          if (statusResp.ok) {
            const body = await statusResp.json();
            if (body.job) {
              handleJobUpdate(body.job);
            }
          }
        } catch (err) {
          if (signal?.aborted) {
            resolved = true;
            cleanup();
            reject(new Error('Compilation cancelled by user.'));
          }
        }
      }, 1500);
    });

    if (job.status === 'cancelled') {
      throw new Error('Compilation was cancelled.');
    }
    if (job.status !== 'completed' || !job.renderedVideo?.id) {
      throw new Error(job.error || 'Background render failed without an error message.');
    }
    jobCompleted = true;

    if (job.savedDestinationPath) {
      logs.push(`[Native Engine] Automatically saved to disk: ${job.savedDestinationPath}`);
    }
    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
    onProgress?.({
      stage: 'finalizing',
      percentage: 96,
      message: 'Render complete. Downloading the finished file...',
      logs: [...logs, ...(job.logs || []).slice(-40)],
    });

    let outputBlob: Blob | null = null;
    let lastDownloadError: Error | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const downloadResponse = await fetch(
          `/api/renders/${job.renderedVideo.id}?download=1`,
          { signal }
        );
        if (!downloadResponse.ok) {
          throw new Error(
            `Render finished, but download failed (HTTP ${downloadResponse.status}).`
          );
        }
        const downloadedBlob = await downloadResponse.blob();
        if (downloadedBlob.size === 0) {
          throw new Error('Received an empty file from the render library.');
        }
        outputBlob = downloadedBlob;
        break;
      } catch (error) {
        if (signal?.aborted) throw error;
        lastDownloadError = error instanceof Error ? error : new Error(String(error));
        if (attempt < 3) {
          logs.push(
            `[Native Engine] Download attempt ${attempt} failed; retrying in 1 second...`
          );
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    }
    if (!outputBlob) {
      throw new Error(
        lastDownloadError?.message || 'Render finished, but downloading the file failed.'
      );
    }

    const typedBlob = isZip
      ? new Blob([outputBlob], { type: 'application/zip' })
      : new Blob([outputBlob], { type: 'video/mp4' });

    const apiUrl = job.renderedVideo?.id ? `/api/renders/${job.renderedVideo.id}` : undefined;
    const downloadApiUrl = apiUrl ? `${apiUrl}?download=1` : undefined;

    // Attach API output URL directly to Blob so consumer state has immediate access to the server resource
    Object.assign(typedBlob, {
      outputUrl: apiUrl,
      downloadUrl: downloadApiUrl,
      renderId: job.renderedVideo?.id,
      renderedVideo: job.renderedVideo,
    });

    onProgress?.({
      stage: 'completed',
      percentage: 100,
      message: isZip
        ? `Clips ZIP package ready in ${elapsedSec}s (${matches.length} clips, ${(typedBlob.size / (1024 * 1024)).toFixed(2)} MB).`
        : `Video ready in ${elapsedSec}s (${(typedBlob.size / (1024 * 1024)).toFixed(2)} MB).`,
      logs: [...logs, ...(job.logs || []).slice(-40)],
      outputBlob: typedBlob,
      outputUrl: apiUrl,
      outputSize: typedBlob.size,
      exportMode: options.exportMode || 'single',
      clipCount: matches.length,
      jobId,
      savedDestinationPath: job.savedDestinationPath,
    });

    logs.push(`[Success] ${isZip ? 'Clips ZIP Archive' : 'Video'} output size: ${(typedBlob.size / (1024 * 1024)).toFixed(2)} MB`);
    return typedBlob;
  } catch (error) {
    if (nativeServerActive) {
      const nativeError = error instanceof Error ? error : new Error(String(error));
      (nativeError as NativeRenderError).isNativeServerError = true;
      throw nativeError;
    }
    throw error;
  }
}


/**
 * Main video generator.
 * Tries Native FFmpeg Engine first (5-15s).
 * Gracefully falls back to browser WebAssembly if local server is unavailable.
 */
export async function generateSlideshowVideo(
  matches: SyncMatch[],
  options: RenderOptions = {}
): Promise<Blob> {
  matches = withClipZoomMetadata(matches, options.motionSettings?.zoomDirection);
  const targetResolution = options.resolution || '720p';
  const targetPreset = RESOLUTION_PRESETS[targetResolution];
  const width = options.width || targetPreset.width;
  const height = options.height || targetPreset.height;
  const { onProgress, signal } = options;
  const logs: string[] = [];
  let highestPercentage = 0;
  let lastMonotonicUpdateTime = 0;
  const emitMonotonicProgress = (update: RenderProgress) => {
    if (update.stage === 'error') {
      onProgress?.(update);
      return;
    }
    if (update.stage === 'completed') {
      highestPercentage = 100;
      onProgress?.({ ...update, percentage: 100 });
      return;
    }
    const clamped = Math.min(
      99,
      Math.max(highestPercentage, Math.round(update.percentage || 0))
    );
    highestPercentage = clamped;
    const now = performance.now();
    if (now - lastMonotonicUpdateTime > 100 || clamped >= 95 || update.stage !== 'encoding') {
      lastMonotonicUpdateTime = now;
      onProgress?.({ ...update, percentage: clamped });
    }
  };
  const progressOptions: RenderOptions = {
    ...options,
    onProgress: emitMonotonicProgress,
  };

  const addLog = (msg: string) => {
    logs.push(msg);
    if (logs.length > 100) logs.shift();
  };

  if (signal?.aborted) {
    throw new Error('Compilation cancelled by user.');
  }

  // Immediate progress notification so UI never stays at 0%
  emitMonotonicProgress({
    stage: 'preparing',
    percentage: 5,
    message: 'Initializing video compilation pipeline...',
    logs: ['[Init] Starting synchronized video generation...'],
  });

  // 1. Try Native High-Speed Server Engine (5-15 seconds) unless explicitly disabled
  if (options.engine !== 'webcodecs' && options.engine !== 'compatibility') {
    try {
      return await renderWithNativeServer(matches, progressOptions, logs);
    } catch (nativeErr: unknown) {
      if (signal?.aborted) {
        throw new Error('Compilation cancelled by user.');
      }
      const nativeError = nativeErr instanceof Error ? nativeErr : new Error(String(nativeErr));
      const markedNativeError = nativeErr as NativeRenderError | null;
      if (markedNativeError?.isNativeServerError) {
        emitMonotonicProgress({
          stage: 'error',
          percentage: highestPercentage,
          message: nativeError.message,
          logs,
          error: nativeError.message,
        });
        throw nativeError;
      }
      if (!markedNativeError?.nativeFallbackEligible) {
        emitMonotonicProgress({
          stage: 'error',
          percentage: highestPercentage,
          message: nativeError.message,
          logs,
          error: nativeError.message,
        });
        throw nativeError;
      }
      console.warn('Native server compilation failed, falling back to browser WebAssembly...', nativeErr);
      addLog(`[Warning] Native local engine unavailable (${nativeError.message}). Falling back to browser WebAssembly...`);
    }
  }

  try {
    // If WebCodecs engine explicitly requested
    if (options.engine === 'webcodecs') {
      return await renderWithWebCodecsVideoEncoder(matches, progressOptions, logs);
    }

    // Stage 1: Parallel Image Normalization with Memoization Cache
    emitMonotonicProgress({
      stage: 'preparing',
      percentage: 5,
      message: `Downscaling and normalizing images in parallel (${targetPreset.label})...`,
      logs,
    });
    addLog(`[Prep] Parallel downscaling to ${width}x${height} with memoization cache...`);

    for (let i = 0; i < matches.length; i++) {
      if (!matches[i].image) {
        throw new Error(`Missing image for slide ${i + 1}`);
      }
    }

    const itemsToNormalize = matches.map((m) => ({
      previewUrl: m.image!.previewUrl,
      file: m.image!.file,
      id: m.image!.id,
      name: m.image!.name,
      duration: m.duration,
    }));

    const normalizedResults = await normalizeImagesInParallel(
      itemsToNormalize,
      width,
      height,
      (completedCount: number, total: number) => {
        const prepPct = Math.round(5 + (completedCount / total) * 20);
        emitMonotonicProgress({
          stage: 'preparing',
          percentage: prepPct,
          message: `Normalized ${completedCount} of ${total} images...`,
          logs,
        });
      }
    );

    const processedImages = normalizedResults.map(
      ({ result, index }: { result: NormalizedImageResult; index: number }) => ({
        name: `slide_${String(index).padStart(3, '0')}.jpg`,
        uint8Array: result.uint8Array,
        duration: matches[index].duration,
      })
    );

    addLog(`[Prep] Image preparation completed for ${processedImages.length} slides.`);

    // Stage 2: Initialize FFmpeg
    emitMonotonicProgress({
      stage: 'loading-ffmpeg',
      percentage: 28,
      message: 'Loading FFmpeg video core...',
      logs,
    });
    addLog('[FFmpeg] Initializing WebAssembly video engine...');

    let ffmpeg: FFmpeg;
    try {
      ffmpeg = await getFFmpeg((msg) => {
        addLog(`[FFmpeg Core] ${msg}`);
      });
    } catch (wasmError) {
      console.warn('FFmpeg WebAssembly failed, switching to Canvas fallback', wasmError);
      addLog(`[Warning] FFmpeg Wasm not available: ${wasmError}. Switching to browser fallback...`);
      return await renderCanvasFallback(matches, progressOptions, logs);
    }

    // Stage 3: Parallel Virtual Filesystem Write with Promise.all
    emitMonotonicProgress({
      stage: 'encoding',
      percentage: 35,
      message: 'Writing slide data to virtual filesystem in parallel...',
      logs,
    });

    await Promise.all(
      processedImages.map((item) => ffmpeg.writeFile(item.name, item.uint8Array))
    );

    // Stage 4: Generate input.txt concat demuxer file
    let concatContent = '';
    for (let i = 0; i < processedImages.length; i++) {
      const img = processedImages[i];
      concatContent += `file '${img.name}'\n`;
      concatContent += `duration ${img.duration.toFixed(3)}\n`;
    }
    // Repeat last image per FFmpeg concat requirement
    if (processedImages.length > 0) {
      const lastImg = processedImages[processedImages.length - 1];
      concatContent += `file '${lastImg.name}'\n`;
    }

    await ffmpeg.writeFile('input.txt', new TextEncoder().encode(concatContent));

    // Stage 5: Execute FFmpeg command
    emitMonotonicProgress({
      stage: 'encoding',
      percentage: 45,
      message: 'Encoding synchronized silent MP4 video with H.264...',
      logs,
    });

    const totalVideoDuration = matches.reduce((acc, m) => acc + m.duration, 0);

    const progressListener = ({ progress, time }: { progress: number; time: number }) => {
      let pct = 45;
      if (progress && progress > 0 && progress <= 1) {
        pct = Math.round(45 + progress * 45);
      } else if (time && totalVideoDuration > 0) {
        const timeInSec = time / 1000000;
        pct = Math.round(45 + (timeInSec / totalVideoDuration) * 45);
      }
      emitMonotonicProgress({
        stage: 'encoding',
        percentage: Math.min(92, Math.max(45, pct)),
        message: `Encoding frames (${Math.min(100, Math.round(progress * 100 || (time / 1000000 / totalVideoDuration) * 100))}%)`,
        logs,
      });
    };

    ffmpeg.on('progress', progressListener);

    let audioFileName: string | null = null;
    if (options.voiceoverFile) {
      try {
        const isMp3 = options.voiceoverFile instanceof File
          ? options.voiceoverFile.name.toLowerCase().endsWith('.mp3')
          : false;
        audioFileName = isMp3 ? 'audio_track.mp3' : 'audio_track.wav';
        const audioBuffer = await options.voiceoverFile.arrayBuffer();
        await ffmpeg.writeFile(audioFileName, new Uint8Array(audioBuffer));
        addLog(`[FFmpeg] Voiceover track loaded into virtual FS: ${audioFileName}`);
      } catch (audioErr) {
        console.warn('Could not write voiceover to FFmpeg virtual FS:', audioErr);
        addLog(`[Warning] Could not load audio track: ${audioErr}. Continuing with silent video.`);
        audioFileName = null;
      }
    }

    addLog('[FFmpeg] Executing: compiling video slides and audio track...');

    const ffmpegCmdArgs = [
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      'input.txt',
    ];

    if (audioFileName) {
      ffmpegCmdArgs.push('-i', audioFileName);
    }

    ffmpegCmdArgs.push(
      '-vf',
      'fps=fps=30:round=near,format=yuv420p',
      '-r',
      '30',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-g',
      '30',
      '-keyint_min',
      '30',
      '-sc_threshold',
      '0',
      '-threads',
      '0',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart'
    );

    const enforcedDuration =
      options.totalDuration && options.totalDuration > 0
        ? options.totalDuration
        : (matches.length > 0
            ? matches[matches.length - 1].endTime
            : totalVideoDuration);

    if (audioFileName) {
      ffmpegCmdArgs.push('-c:a', 'aac', '-b:a', '192k', '-ar', '44100');
    }

    ffmpegCmdArgs.push('-t', enforcedDuration.toFixed(3));
    ffmpegCmdArgs.push('output.mp4');

    const exitCode = await ffmpeg.exec(ffmpegCmdArgs);

    ffmpeg.off('progress', progressListener);

    if (exitCode !== 0) {
      throw new Error(`FFmpeg execution failed with exit code ${exitCode}`);
    }

    // Stage 6: Finalizing & Extract Output
    emitMonotonicProgress({
      stage: 'finalizing',
      percentage: 95,
      message: 'Extracting rendered MP4 video file...',
      logs,
    });

    const rawData = await ffmpeg.readFile('output.mp4');
    const uint8 = typeof rawData === 'string'
      ? new TextEncoder().encode(rawData)
      : new Uint8Array(rawData);
    const outputBlob = new Blob([uint8.buffer as ArrayBuffer], { type: 'video/mp4' });

    // Clean up virtual files in parallel
    await Promise.all([
      ffmpeg.deleteFile('input.txt').catch(() => {}),
      ffmpeg.deleteFile('output.mp4').catch(() => {}),
      ...(audioFileName ? [ffmpeg.deleteFile(audioFileName).catch(() => {})] : []),
      ...processedImages.map((item) => ffmpeg.deleteFile(item.name).catch(() => {})),
    ]);

    emitMonotonicProgress({
      stage: 'completed',
      percentage: 100,
      message: 'Video rendering finished successfully!',
      logs,
      outputBlob,
      outputSize: outputBlob.size,
    });

    addLog(`[Success] Video output size: ${(outputBlob.size / (1024 * 1024)).toFixed(2)} MB`);
    return outputBlob;
  } catch (error) {
    if (options.signal?.aborted) {
      throw error;
    }
    const errorMsg = error instanceof Error ? error.message : String(error);
    addLog(`[Error] Video generation failed: ${errorMsg}`);

    // If FFmpeg threw during encoding, try browser fallback as last resort
    try {
      addLog('[Fallback] Attempting fallback renderer...');
      return await renderCanvasFallback(matches, progressOptions, logs);
    } catch {
      emitMonotonicProgress({
        stage: 'error',
        percentage: highestPercentage,
        message: `Rendering failed: ${errorMsg}`,
        logs,
        error: errorMsg,
      });
      throw error;
    }
  }
}
