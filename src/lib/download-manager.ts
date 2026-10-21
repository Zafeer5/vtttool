import JSZip from 'jszip';
import { SyncMatch } from './types';

export interface ExtractedVideoClip {
  id: string;
  filename: string;
  displayName: string;
  blob: Blob;
  url: string;
  sizeBytes: number;
  duration?: number;
  startTime?: number;
  endTime?: number;
  isFullVideo: boolean;
  slideIndex?: number;
  thumbnailUrl?: string;
  matchedText?: string;
}

export interface ExtractedPackage {
  zipBlob: Blob;
  zipUrl: string;
  zipFilename: string;
  fullVideo: ExtractedVideoClip | null;
  clips: ExtractedVideoClip[];
  allVideos: ExtractedVideoClip[];
  totalSize: number;
  isArchive: boolean;
}

/**
 * Checks whether a given Blob is a ZIP archive by MIME type or magic bytes.
 */
export async function isZipBlob(blob: Blob, filename?: string): Promise<boolean> {
  if (blob.type === 'application/zip' || blob.type === 'application/x-zip-compressed') {
    return true;
  }
  if (filename && filename.toLowerCase().endsWith('.zip')) {
    return true;
  }
  try {
    const slice = blob.slice(0, 4);
    const buffer = await slice.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    // Standard ZIP local file header signature: 0x50 0x4B 0x03 0x04 (PK\x03\x04)
    return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 0x03 && bytes[3] === 0x04;
  } catch {
    return false;
  }
}

/**
 * Parses rendered output blob (whether ZIP archive or single MP4) into an
 * accessible package containing the complete ZIP, individual slide clips, and full video.
 */
export async function parseRenderedPackage(
  blob: Blob,
  outputFileName?: string,
  matches: SyncMatch[] = []
): Promise<ExtractedPackage> {
  const isArchive = await isZipBlob(blob, outputFileName);
  const cleanBaseName = outputFileName
    ? outputFileName.replace(/\.(mp4|zip)$/i, '')
    : `slideshow_${Date.now()}`;

  if (isArchive) {
    const zip = await JSZip.loadAsync(blob);
    const clips: ExtractedVideoClip[] = [];
    let fullVideo: ExtractedVideoClip | null = null;

    const entries = Object.keys(zip.files).filter(
      (name) => !zip.files[name].dir && name.toLowerCase().endsWith('.mp4')
    );

    // Extract MP4 files from ZIP
    for (const name of entries) {
      const file = zip.files[name];
      const fileBlob = await file.async('blob');
      const url = URL.createObjectURL(fileBlob);
      const isFull =
        name.toLowerCase().includes('full') ||
        name.toLowerCase().includes('slideshow_video') ||
        (!name.toLowerCase().startsWith('clip_') && entries.length > 1);

      // Attempt to parse clip index e.g. clip_001_...
      const clipIndexMatch = name.match(/clip_(\d+)/i);
      const slideIndex = clipIndexMatch ? parseInt(clipIndexMatch[1], 10) - 1 : undefined;
      const match = slideIndex !== undefined && matches[slideIndex] ? matches[slideIndex] : undefined;

      const clipItem: ExtractedVideoClip = {
        id: name,
        filename: name,
        displayName: isFull
          ? 'Full Continuous Video'
          : slideIndex !== undefined
          ? `Clip #${slideIndex + 1} (${match?.duration.toFixed(1) || '0'}s)`
          : name,
        blob: fileBlob,
        url,
        sizeBytes: fileBlob.size,
        duration: match?.duration,
        startTime: match?.startTime,
        endTime: match?.endTime,
        isFullVideo: isFull,
        slideIndex,
        thumbnailUrl: match?.image?.previewUrl,
        matchedText: match?.matchedTextSnippet || match?.triggerSentence,
      };

      if (isFull) {
        fullVideo = clipItem;
      } else {
        clips.push(clipItem);
      }
    }

    // Sort clips in ascending order by slide index
    clips.sort((a, b) => {
      const idxA = a.slideIndex ?? 0;
      const idxB = b.slideIndex ?? 0;
      return idxA - idxB;
    });

    // If no explicit full video was found, use the first clip or assemble
    if (!fullVideo && clips.length > 0) {
      fullVideo = clips[0];
    }

    const allVideos: ExtractedVideoClip[] = [];
    if (fullVideo) allVideos.push(fullVideo);
    allVideos.push(...clips);

    const zipBlob = blob.type === 'application/zip' ? blob : new Blob([blob], { type: 'application/zip' });
    const zipUrl = URL.createObjectURL(zipBlob);
    const zipFilename = outputFileName?.toLowerCase().endsWith('.zip')
      ? outputFileName
      : `${cleanBaseName}_complete_package.zip`;

    return {
      zipBlob,
      zipUrl,
      zipFilename,
      fullVideo,
      clips,
      allVideos,
      totalSize: blob.size,
      isArchive: true,
    };
  } else {
    // Single MP4 mode: generate an in-memory ZIP package on the fly so all 3 download choices are available
    const fullVideoName = outputFileName?.toLowerCase().endsWith('.mp4')
      ? outputFileName
      : `${cleanBaseName}.mp4`;
    const fullVideoUrl = URL.createObjectURL(blob);

    const fullVideo: ExtractedVideoClip = {
      id: 'full_video_mp4',
      filename: fullVideoName,
      displayName: 'Full Continuous Video',
      blob,
      url: fullVideoUrl,
      sizeBytes: blob.size,
      duration: matches.length > 0 ? matches[matches.length - 1].endTime : undefined,
      isFullVideo: true,
      slideIndex: 0,
      thumbnailUrl: matches[0]?.image?.previewUrl,
    };

    // Pack into a ZIP in memory
    const zip = new JSZip();
    zip.file(fullVideoName, blob);
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const zipUrl = URL.createObjectURL(zipBlob);
    const zipFilename = `${cleanBaseName}_package.zip`;

    return {
      zipBlob,
      zipUrl,
      zipFilename,
      fullVideo,
      clips: [],
      allVideos: [fullVideo],
      totalSize: blob.size,
      isArchive: false,
    };
  }
}

/**
 * Triggers a single file download in the browser.
 */
export function downloadFile(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * Triggers multiple file downloads with a controlled stagger delay
 * to prevent browser pop-up blockers from silencing downloads.
 */
export async function downloadMultipleFiles(
  files: { url: string; filename: string }[],
  onProgress?: (completed: number, total: number) => void
): Promise<void> {
  for (let i = 0; i < files.length; i++) {
    downloadFile(files[i].url, files[i].filename);
    onProgress?.(i + 1, files.length);
    if (i < files.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
}
