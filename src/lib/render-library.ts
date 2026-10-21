import fs from 'fs';
import path from 'path';
import { RenderedVideoItem, ExportMode } from './types';

const RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

export function getLibraryDir(): string {
  const dataDir = process.env.VTT_DATA_DIR || process.cwd();
  const dir = path.join(dataDir, 'output', 'rendered_videos');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Automatically purges any rendered video and metadata older than 24 hours.
 * Note: Downloaded copies saved on the user's computer are never touched.
 */
export async function purgeExpiredVideos(): Promise<number> {
  const dir = getLibraryDir();
  let purgedCount = 0;
  const now = Date.now();

  try {
    const files = await fs.promises.readdir(dir);
    const jsonFiles = files.filter((f) => f.endsWith('.json'));

    for (const jsonFile of jsonFiles) {
      const jsonPath = path.join(dir, jsonFile);
      try {
        const raw = await fs.promises.readFile(jsonPath, 'utf-8');
        const data = JSON.parse(raw);
        const expiresAt = data.expiresAt ? new Date(data.expiresAt).getTime() : 0;
        const createdAt = data.createdAt ? new Date(data.createdAt).getTime() : 0;

        const isExpired = expiresAt > 0 ? now >= expiresAt : now - createdAt >= RETENTION_MS;

        if (isExpired) {
          const id = data.id || jsonFile.replace(/\.json$/, '');
          const mp4Path = path.join(dir, `${id}.mp4`);
          const zipPath = path.join(dir, `${id}.zip`);
          const thumbPath = path.join(dir, `${id}_thumb.jpg`);

          if (fs.existsSync(mp4Path)) {
            await fs.promises.unlink(mp4Path).catch(() => {});
          }
          if (fs.existsSync(zipPath)) {
            await fs.promises.unlink(zipPath).catch(() => {});
          }
          if (fs.existsSync(thumbPath)) {
            await fs.promises.unlink(thumbPath).catch(() => {});
          }
          await fs.promises.unlink(jsonPath).catch(() => {});
          purgedCount++;
        }
      } catch {
        // If corrupt, check mtime
        const stat = await fs.promises.stat(jsonPath).catch(() => null);
        if (stat && now - stat.mtimeMs >= RETENTION_MS) {
          await fs.promises.unlink(jsonPath).catch(() => {});
          purgedCount++;
        }
      }
    }

    // Also clean up orphan .mp4, .zip, or _thumb.jpg files older than 24 hours without json
    for (const file of files) {
      if (file.endsWith('.mp4') || file.endsWith('.zip') || file.endsWith('_thumb.jpg')) {
        const filePath = path.join(dir, file);
        const stat = await fs.promises.stat(filePath).catch(() => null);
        if (stat && now - stat.mtimeMs >= RETENTION_MS) {
          await fs.promises.unlink(filePath).catch(() => {});
        }
      }
    }
  } catch (err) {
    console.error('Error during 24h video library purge:', err);
  }

  return purgedCount;
}

/**
 * Saves a completed render into the 24-hour persistent library.
 */
export async function saveRenderedVideo(params: {
  tempVideoPath: string;
  duration: number;
  slideCount: number;
  resolution: string;
  title?: string;
  filename?: string;
  firstImagePath?: string | null;
  videoBuffer?: Buffer | null;
  isZip?: boolean;
  exportMode?: ExportMode;
}): Promise<RenderedVideoItem> {
  const dir = getLibraryDir();
  const id = `render_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + RETENTION_MS);

  const isZip = params.isZip || params.exportMode === 'clips_zip' || params.tempVideoPath.endsWith('.zip');
  const targetExt = isZip ? '.zip' : '.mp4';
  const outFilePath = path.join(dir, `${id}${targetExt}`);
  const jsonPath = path.join(dir, `${id}.json`);
  const thumbPath = path.join(dir, `${id}_thumb.jpg`);

  // Copy or write file
  if (params.videoBuffer) {
    await fs.promises.writeFile(outFilePath, params.videoBuffer);
  } else if (params.tempVideoPath && fs.existsSync(params.tempVideoPath)) {
    await fs.promises.copyFile(params.tempVideoPath, outFilePath);
  } else {
    throw new Error('No valid source file provided to saveRenderedVideo.');
  }

  // Copy first image as thumbnail if available
  let hasThumbnail = false;
  if (params.firstImagePath && fs.existsSync(params.firstImagePath)) {
    try {
      await fs.promises.copyFile(params.firstImagePath, thumbPath);
      hasThumbnail = true;
    } catch {
      hasThumbnail = false;
    }
  }

  const stat = await fs.promises.stat(outFilePath);
  const defaultTitle = isZip
    ? `Slideshow Clips ZIP (${params.slideCount} clips, ${params.resolution || '1080p'})`
    : `Slideshow Render (${params.slideCount} slides, ${params.resolution || '1080p'})`;
  const defaultFilename = isZip ? 'slideshow_clips.zip' : 'slideshow_video.mp4';
  const rawName = params.filename?.trim() || params.title?.trim();
  const title = rawName || defaultTitle;
  const cleanTitleName = rawName
    ? (rawName.toLowerCase().endsWith(targetExt)
        ? rawName
        : `${rawName.replace(/\.(mp4|zip)$/i, '')}${targetExt}`)
    : defaultFilename;

  const item: RenderedVideoItem = {
    id,
    title,
    filename: cleanTitleName,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    duration: Number(params.duration.toFixed(2)),
    slideCount: params.slideCount,
    resolution: params.resolution,
    fileSizeBytes: stat.size,
    downloadUrl: `/api/renders/${id}?download=1`,
    streamUrl: `/api/renders/${id}`,
    thumbnailUrl: hasThumbnail ? `/api/renders/${id}/thumb` : undefined,
    hasThumbnail,
    exportMode: isZip ? 'clips_zip' : 'single',
  };

  await fs.promises.writeFile(jsonPath, JSON.stringify(item, null, 2), 'utf-8');

  // Trigger non-blocking purge of any old expired files
  purgeExpiredVideos().catch(() => {});

  return item;
}

/**
 * Returns all active rendered videos within their 24-hour retention window.
 */
export async function listRenderedVideos(): Promise<RenderedVideoItem[]> {
  await purgeExpiredVideos();
  const dir = getLibraryDir();
  const items: RenderedVideoItem[] = [];

  try {
    const files = await fs.promises.readdir(dir);
    const jsonFiles = files.filter((f) => f.endsWith('.json'));

    for (const jsonFile of jsonFiles) {
      try {
        const fullPath = path.join(dir, jsonFile);
        const content = await fs.promises.readFile(fullPath, 'utf-8');
        const parsed = JSON.parse(content) as RenderedVideoItem;

        const outputPath = path.join(
          dir,
          `${parsed.id}${parsed.exportMode === 'clips_zip' ? '.zip' : '.mp4'}`
        );
        if (fs.existsSync(outputPath)) {
          parsed.downloadUrl = `/api/renders/${parsed.id}?download=1`;
          parsed.streamUrl = `/api/renders/${parsed.id}`;
          parsed.thumbnailUrl = parsed.hasThumbnail ? `/api/renders/${parsed.id}/thumb` : undefined;
          items.push(parsed);
        }
      } catch (err) {
        console.warn(`Could not read metadata for ${jsonFile}:`, err);
      }
    }
  } catch (err) {
    console.error('Error listing rendered videos:', err);
  }

  // Sort newest first
  items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return items;
}

/**
 * Retrieves the full path to a video file if it exists.
 */
export async function getVideoFilePath(id: string): Promise<string | null> {
  const dir = getLibraryDir();
  const mp4Path = path.join(dir, `${id}.mp4`);
  if (fs.existsSync(mp4Path)) {
    return mp4Path;
  }
  const zipPath = path.join(dir, `${id}.zip`);
  if (fs.existsSync(zipPath)) {
    return zipPath;
  }
  return null;
}

/**
 * Retrieves the thumbnail file path if it exists.
 */
export async function getThumbFilePath(id: string): Promise<string | null> {
  const dir = getLibraryDir();
  const thumbPath = path.join(dir, `${id}_thumb.jpg`);
  if (fs.existsSync(thumbPath)) {
    return thumbPath;
  }
  return null;
}

/**
 * Deletes a video and its metadata from the 24-hour library.
 */
export async function deleteRenderedVideo(id: string): Promise<boolean> {
  const dir = getLibraryDir();
  let deleted = false;

  const mp4Path = path.join(dir, `${id}.mp4`);
  const zipPath = path.join(dir, `${id}.zip`);
  const jsonPath = path.join(dir, `${id}.json`);
  const thumbPath = path.join(dir, `${id}_thumb.jpg`);

  if (fs.existsSync(mp4Path)) {
    await fs.promises.unlink(mp4Path).catch(() => {});
    deleted = true;
  }
  if (fs.existsSync(zipPath)) {
    await fs.promises.unlink(zipPath).catch(() => {});
    deleted = true;
  }
  if (fs.existsSync(thumbPath)) {
    await fs.promises.unlink(thumbPath).catch(() => {});
  }
  if (fs.existsSync(jsonPath)) {
    await fs.promises.unlink(jsonPath).catch(() => {});
    deleted = true;
  }

  return deleted;
}

// Background periodic cleanup every 15 minutes to guarantee 24h reset
if (typeof setInterval !== 'undefined') {
  const globalObj = globalThis as unknown as { __vttLibraryPurgeInterval?: NodeJS.Timeout };
  if (!globalObj.__vttLibraryPurgeInterval) {
    globalObj.__vttLibraryPurgeInterval = setInterval(() => {
      purgeExpiredVideos().catch(() => {});
    }, 15 * 60 * 1000);
  }
}
