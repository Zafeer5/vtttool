/**
 * Helper to normalize, downscale, and prepare images for FFmpeg and WebCodecs encoding.
 * Supports multi-threaded Web Workers with OffscreenCanvas, in-memory memoization cache,
 * and graceful fallback to main-thread canvas.
 */

export interface NormalizedImageResult {
  blob: Blob;
  uint8Array: Uint8Array;
  width: number;
  height: number;
}

export type VideoResolution = '720p' | '1080p';

export const RESOLUTION_PRESETS: Record<VideoResolution, { width: number; height: number; label: string }> = {
  '720p': { width: 1280, height: 720, label: '1280x720' },
  '1080p': { width: 1920, height: 1080, label: '1920x1080' },
};

// In-memory memoization cache for normalized image buffers
const normalizationCache = new Map<string, NormalizedImageResult>();

export function clearNormalizationCache(): void {
  normalizationCache.clear();
}

export function getNormalizationCacheSize(): number {
  return normalizationCache.size;
}

export function getCacheKey(
  item: { previewUrl: string; file?: File; id?: string; name?: string },
  targetWidth: number,
  targetHeight: number,
  quality: number
): string {
  if (item.file) {
    return `file_${item.file.name}_${item.file.size}_${item.file.lastModified}_${targetWidth}x${targetHeight}_q${quality}`;
  }
  return `url_${item.id || item.name || ''}_${item.previewUrl}_${targetWidth}x${targetHeight}_q${quality}`;
}

/**
 * Loads an image from a URL or Blob into an HTMLImageElement.
 */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(new Error(`Failed to load image: ${err}`));
    img.src = src;
  });
}

/**
 * Main-thread canvas normalization fallback.
 */
export async function normalizeImageToCanvas(
  imageUrl: string,
  targetWidth = 1920,
  targetHeight = 1080,
  quality = 0.82
): Promise<NormalizedImageResult> {
  const img = await loadImage(imageUrl);

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d', { alpha: false });

  if (!ctx) {
    throw new Error('Canvas 2D context not available');
  }

  ctx.fillStyle = '#080c14';
  ctx.fillRect(0, 0, targetWidth, targetHeight);

  const imgW = img.naturalWidth || img.width;
  const imgH = img.naturalHeight || img.height;
  const imgAspect = imgW / imgH;
  const targetAspect = targetWidth / targetHeight;

  if (Math.abs(imgAspect - targetAspect) > 0.02) {
    const miniW = 32;
    const miniH = 18;
    const miniCanvas = document.createElement('canvas');
    miniCanvas.width = miniW;
    miniCanvas.height = miniH;
    const miniCtx = miniCanvas.getContext('2d', { alpha: false });
    if (miniCtx) {
      miniCtx.drawImage(img, 0, 0, miniW, miniH);
      ctx.save();
      ctx.globalAlpha = 0.38;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'medium';
      ctx.drawImage(miniCanvas, 0, 0, targetWidth, targetHeight);
      ctx.restore();
    }
  }

  let renderW = targetWidth;
  let renderH = targetHeight;

  if (imgAspect > targetAspect) {
    renderW = targetWidth;
    renderH = targetWidth / imgAspect;
  } else {
    renderH = targetHeight;
    renderW = targetHeight * imgAspect;
  }

  const renderX = (targetWidth - renderW) / 2;
  const renderY = (targetHeight - renderH) / 2;

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, renderX, renderY, renderW, renderH);
  ctx.restore();

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error('Canvas toBlob conversion failed'));
      },
      'image/jpeg',
      quality
    );
  });

  const arrayBuffer = await blob.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  return {
    blob,
    uint8Array,
    width: targetWidth,
    height: targetHeight,
  };
}

// Inline Web Worker script for offloading decode, resize, and JPEG encode to background CPU threads
const WORKER_CODE = `
self.onmessage = async (e) => {
  const { id, imageBlob, width, height, quality } = e.data;
  try {
    const bitmap = await createImageBitmap(imageBlob);
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable');

    ctx.fillStyle = '#080c14';
    ctx.fillRect(0, 0, width, height);

    const srcW = bitmap.width;
    const srcH = bitmap.height;
    const srcAspect = srcW / srcH;
    const targetAspect = width / height;

    if (Math.abs(srcAspect - targetAspect) > 0.02) {
      const miniCanvas = new OffscreenCanvas(32, 18);
      const miniCtx = miniCanvas.getContext('2d', { alpha: false });
      if (miniCtx) {
        miniCtx.drawImage(bitmap, 0, 0, 32, 18);
        ctx.save();
        ctx.globalAlpha = 0.38;
        ctx.drawImage(miniCanvas, 0, 0, width, height);
        ctx.restore();
      }
    }

    let renderW = width;
    let renderH = height;
    if (srcAspect > targetAspect) {
      renderW = width;
      renderH = width / srcAspect;
    } else {
      renderH = height;
      renderW = height * srcAspect;
    }
    const renderX = (width - renderW) / 2;
    const renderY = (height - renderH) / 2;

    ctx.drawImage(bitmap, renderX, renderY, renderW, renderH);
    bitmap.close();

    const outputBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: quality || 0.82 });
    const buffer = await outputBlob.arrayBuffer();

    self.postMessage({ id, success: true, buffer, width, height }, [buffer]);
  } catch (err) {
    self.postMessage({ id, success: false, error: err ? err.message : String(err) });
  }
};
`;

let workerBlobUrl: string | null = null;
function getWorkerUrl(): string {
  if (!workerBlobUrl) {
    const blob = new Blob([WORKER_CODE], { type: 'application/javascript' });
    workerBlobUrl = URL.createObjectURL(blob);
  }
  return workerBlobUrl;
}

/**
 * Checks if Web Worker + OffscreenCanvas is supported in current environment.
 */
function isWorkerOffscreenSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof Worker !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined' &&
    typeof createImageBitmap !== 'undefined'
  );
}

/**
 * Normalizes a single image using a Web Worker.
 */
async function normalizeWithWorker(
  imageBlob: Blob,
  width: number,
  height: number,
  quality = 0.82
): Promise<NormalizedImageResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(getWorkerUrl());
    const id = Math.random().toString(36).substring(2);

    worker.onmessage = (e) => {
      const data = e.data;
      if (data.id !== id) return;
      worker.terminate();

      if (data.success) {
        const uint8Array = new Uint8Array(data.buffer);
        const blob = new Blob([uint8Array.buffer], { type: 'image/jpeg' });
        resolve({
          blob,
          uint8Array,
          width: data.width,
          height: data.height,
        });
      } else {
        reject(new Error(data.error || 'Worker normalization failed'));
      }
    };

    worker.onerror = (err) => {
      worker.terminate();
      reject(err);
    };

    worker.postMessage({ id, imageBlob, width, height, quality });
  });
}

/**
 * Normalizes an array of images in parallel across multiple worker threads,
 * using in-memory memoization to skip re-processing unchanged images.
 */
export async function normalizeImagesInParallel<
  T extends { previewUrl: string; file?: File; id?: string; name?: string }
>(
  items: T[],
  targetWidth = 1920,
  targetHeight = 1080,
  onItemDone?: (completedCount: number, total: number) => void,
  quality = 0.82
): Promise<{ item: T; result: NormalizedImageResult; index: number }[]> {
  const supportsWorkers = isWorkerOffscreenSupported();
  let completed = 0;
  const hardwareConcurrency =
    typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  const maxConcurrent = supportsWorkers
    ? Math.min(6, Math.max(2, Math.floor(hardwareConcurrency / 2)))
    : 1;

  const inFlight = new Map<string, Promise<NormalizedImageResult>>();

  const normalizeItem = async (item: T, index: number) => {
    // 1. Check in-memory memoization cache
    const cacheKey = getCacheKey(item, targetWidth, targetHeight, quality);
    const cached = normalizationCache.get(cacheKey);
    if (cached) {
      completed++;
      onItemDone?.(completed, items.length);
      return { item, result: cached, index };
    }

    // 2. Reuse in-flight task if identical image is already processing in another worker
    let promise = inFlight.get(cacheKey);
    if (!promise) {
      promise = (async () => {
        let blob: Blob;
        if (item.file) {
          blob = item.file;
        } else {
          const res = await fetch(item.previewUrl);
          blob = await res.blob();
        }

        let result: NormalizedImageResult;
        if (supportsWorkers) {
          try {
            result = await normalizeWithWorker(blob, targetWidth, targetHeight, quality);
          } catch {
            result = await normalizeImageToCanvas(item.previewUrl, targetWidth, targetHeight, quality);
          }
        } else {
          result = await normalizeImageToCanvas(item.previewUrl, targetWidth, targetHeight, quality);
        }

        normalizationCache.set(cacheKey, result);
        return result;
      })();
      inFlight.set(cacheKey, promise);
    }

    const result = await promise;
    completed++;
    onItemDone?.(completed, items.length);
    return { item, result, index };
  };

  const results: { item: T; result: NormalizedImageResult; index: number }[] = [];
  for (let offset = 0; offset < items.length; offset += maxConcurrent) {
    const batch = items.slice(offset, offset + maxConcurrent);
    results.push(...(await Promise.all(
      batch.map((item, index) => normalizeItem(item, offset + index))
    )));
  }

  return results.sort((a, b) => a.index - b.index);
}
