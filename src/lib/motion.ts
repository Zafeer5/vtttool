import { DEFAULT_ZOOM_INTENSITY, SyncMatch, ZoomDirection } from './types';

export const PREVIEW_FPS = 30;

type ClipZoomDirection = Exclude<SyncMatch['zoomDirection'], undefined>;

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  }
  return (hash >>> 0) || 1;
}

function randomFromSeed(seed: number): number {
  let value = (seed + 0x6d2b79f5) >>> 0;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

function seedForMatch(match: SyncMatch, index: number): number {
  const image = match.image;
  const identity = image
    ? [
        image.name,
        image.size ?? image.file?.size ?? 0,
        image.width ?? 0,
        image.height ?? 0,
        index,
      ].join(':')
    : `missing-image:${index}`;
  return hashSeed(identity);
}

export function withClipZoomMetadata(
  matches: SyncMatch[],
  preferredDirection: ZoomDirection = 'random'
): SyncMatch[] {
  let previousDirection: ClipZoomDirection | null = null;

  return matches.map((match, index) => {
    const seed =
      typeof match.zoomSeed === 'number' &&
      Number.isInteger(match.zoomSeed) &&
      match.zoomSeed >= 0
        ? match.zoomSeed >>> 0
        : seedForMatch(match, index);

    let direction: ClipZoomDirection;
    if (preferredDirection === 'in' || preferredDirection === 'out') {
      direction = preferredDirection;
    } else {
      const randomDirection: ClipZoomDirection =
        randomFromSeed(seed) < 0.5 ? 'in' : 'out';
      direction = randomDirection;
      if (direction === previousDirection) {
        direction = direction === 'in' ? 'out' : 'in';
      }
    }
    previousDirection = direction;

    if (match.zoomSeed === seed && match.zoomDirection === direction) {
      return match;
    }

    return { ...match, zoomSeed: seed, zoomDirection: direction };
  });
}

export function easeInOutSine(progress: number): number {
  const clamped = Math.max(0, Math.min(1, progress));
  return -(Math.cos(Math.PI * clamped) - 1) / 2;
}

export function getZoomScaleForFrame(
  frameIndex: number,
  frameCount: number,
  direction: ClipZoomDirection,
  intensityPercent = DEFAULT_ZOOM_INTENSITY
): number {
  const progress =
    frameCount <= 1
      ? 0
      : Math.max(0, Math.min(1, frameIndex / (frameCount - 1)));
  const eased = easeInOutSine(progress);
  const intensity = Math.max(0, intensityPercent) / 100;

  return direction === 'in'
    ? 1 + intensity * eased
    : 1 + intensity - intensity * eased;
}

export function getZoomScaleAtTime(
  match: SyncMatch,
  time: number,
  intensityPercent = DEFAULT_ZOOM_INTENSITY
): number {
  const duration = Math.max(0.001, match.endTime - match.startTime);
  const progress = Math.max(0, Math.min(1, (time - match.startTime) / duration));
  const eased = easeInOutSine(progress);
  const intensity = Math.max(0, intensityPercent) / 100;
  const direction = match.zoomDirection || 'in';

  return direction === 'in'
    ? 1 + intensity * eased
    : 1 + intensity - intensity * eased;
}

