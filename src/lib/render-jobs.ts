import { randomUUID } from 'crypto';
import { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { RenderedVideoItem, RenderStats } from './types';

export type RenderJobStatus =
  | 'queued'
  | 'preparing'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export interface RenderJob {
  id: string;
  status: RenderJobStatus;
  progress: number;
  message: string;
  createdAt: string;
  updatedAt: string;
  logs: string[];
  error?: string;
  renderedVideo?: RenderedVideoItem;
  savedDestinationPath?: string;
  stats?: RenderStats;
  _lastEmittedProgress?: number;
  outputFileName?: string | null;
  destinationFolder?: string | null;
  resolution?: string;
  exportMode?: 'single' | 'clips_zip';
  duration?: number;
  slideCount?: number;
}

export interface RenderJobExecution {
  tempDirPath: string;
  outputFilePath: string;
  pythonExe: string;
  args: string[];
  cwd: string;
  duration: number;
  slideCount: number;
  resolution: string;
  firstImagePath: string | null;
  isZip: boolean;
  exportMode: 'single' | 'clips_zip';
  destinationFolder: string | null;
  outputFileName: string | null;
}

type RenderJobRuntime = typeof globalThis & {
  __vttRenderJobChildren?: Map<string, ChildProcess>;
  __vttRenderJobRecords?: Map<string, RenderJob>;
  __vttRenderJobWrites?: Map<string, Promise<void>>;
  __vttRenderJobQueue?: { job: RenderJob; execution: RenderJobExecution }[];
  __vttRenderJobRunning?: boolean;
  __vttRenderJobEmitter?: EventEmitter;
};

const runtime = globalThis as RenderJobRuntime;
export const renderJobEmitter: EventEmitter =
  runtime.__vttRenderJobEmitter ??
  (runtime.__vttRenderJobEmitter = new EventEmitter());
renderJobEmitter.setMaxListeners(200);

export function subscribeToJob(
  jobId: string,
  listener: (job: RenderJob) => void
): () => void {
  const eventName = `job:${jobId}`;
  renderJobEmitter.on(eventName, listener);
  return () => {
    renderJobEmitter.off(eventName, listener);
  };
}

function terminateProcessTree(child: ChildProcess): void {
  if (!child || !child.pid) return;
  if (process.platform === 'win32') {
    try {
      const { execSync } = require('child_process');
      execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
      return;
    } catch {}
  }
  try {
    child.kill('SIGKILL');
  } catch {}
}

const activeChildren =
  runtime.__vttRenderJobChildren ?? (runtime.__vttRenderJobChildren = new Map());
const activeRecords =
  runtime.__vttRenderJobRecords ?? (runtime.__vttRenderJobRecords = new Map());
const writeQueues =
  runtime.__vttRenderJobWrites ?? (runtime.__vttRenderJobWrites = new Map());
const renderQueue =
  runtime.__vttRenderJobQueue ?? (runtime.__vttRenderJobQueue = []);

function getJobsDir(): string {
  const dataDir = process.env.VTT_DATA_DIR || process.cwd();
  return path.join(dataDir, 'output', 'render_jobs');
}

function getJobPath(id: string): string {
  if (!/^[a-f0-9-]+$/i.test(id)) {
    throw new Error('Invalid render job ID.');
  }
  return path.join(getJobsDir(), `${id}.json`);
}

async function persistJob(job: RenderJob): Promise<void> {
  const filePath = getJobPath(job.id);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const previousWrite = writeQueues.get(job.id) ?? Promise.resolve();
  const nextWrite = previousWrite
    .catch(() => undefined)
    .then(async () => {
      const temporaryPath = `${filePath}.${process.pid}.tmp`;
      await fs.promises.writeFile(
        temporaryPath,
        JSON.stringify(job, null, 2),
        'utf-8'
      );
      await fs.promises.rename(temporaryPath, filePath);
    });
  writeQueues.set(job.id, nextWrite);
  await nextWrite;
}

const lastPersistTimes = new Map<string, number>();
const pendingPersistTimers = new Map<string, NodeJS.Timeout>();

function updateJob(job: RenderJob, update: Partial<RenderJob>, immediatePersist = false): void {
  Object.assign(job, update, { updatedAt: new Date().toISOString() });
  activeRecords.set(job.id, job);

  const isFinal =
    job.status === 'completed' ||
    job.status === 'failed' ||
    job.status === 'cancelled' ||
    job.status === 'interrupted';
  const lastEmitted = job._lastEmittedProgress ?? -1;
  const progressStepCleared = Math.abs(job.progress - lastEmitted) >= 1;

  if (isFinal || immediatePersist || progressStepCleared || update.status !== undefined) {
    job._lastEmittedProgress = job.progress;
    renderJobEmitter.emit(`job:${job.id}`, job);
  }

  if (immediatePersist || isFinal) {
    const existingTimer = pendingPersistTimers.get(job.id);
    if (existingTimer) {
      clearTimeout(existingTimer);
      pendingPersistTimers.delete(job.id);
    }
    lastPersistTimes.set(job.id, Date.now());
    void persistJob(job).catch((error: unknown) => {
      console.error(`Could not persist render job ${job.id}:`, error);
    });
    return;
  }

  const now = Date.now();
  const lastTime = lastPersistTimes.get(job.id) || 0;
  if (now - lastTime >= 400) {
    lastPersistTimes.set(job.id, now);
    void persistJob(job).catch((error: unknown) => {
      console.error(`Could not persist render job ${job.id}:`, error);
    });
  } else if (!pendingPersistTimers.has(job.id)) {
    const timer = setTimeout(() => {
      pendingPersistTimers.delete(job.id);
      lastPersistTimes.set(job.id, Date.now());
      void persistJob(job).catch((error: unknown) => {
        console.error(`Could not persist render job ${job.id}:`, error);
      });
    }, 400);
    pendingPersistTimers.set(job.id, timer);
  }
}

function isJobCancelled(job: RenderJob): boolean {
  return job.status === 'cancelled';
}

/**
 * Standard Output Logs Parser (Step 2)
 * Parses runtime string updates via regex to extract structured status variables.
 */
function parseStdoutLine(line: string): {
  message?: string;
  progress?: number;
  stats?: Partial<RenderStats>;
} {
  const trimmed = line.trim();
  if (!trimmed) return {};

  const stats: Partial<RenderStats> = {};
  let progress: number | undefined;
  let message: string | undefined;

  // 1. Python progress format: [Progress] 45.2% - 135/300 frames encoded (45%) or [Progress] 96.0% - Assembling...
  const detailedProgressMatch = trimmed.match(
    /\[Progress\]\s+(\d+(?:\.\d+)?)%\s*(?:-\s*(.*))?/i
  );
  if (detailedProgressMatch) {
    progress = Math.min(100, Math.max(1, Math.round(Number(detailedProgressMatch[1]))));
    const subDesc = detailedProgressMatch[2]?.trim() || '';
    const frameSubMatch = subDesc.match(/(\d+)\/(\d+)\s+frames/i);
    if (frameSubMatch) {
      stats.currentFrame = parseInt(frameSubMatch[1], 10);
      stats.totalFrames = parseInt(frameSubMatch[2], 10);
    }
    message = subDesc ? `Rendering: ${subDesc}` : trimmed;
  }

  // 2. FFmpeg status lines: frame=  120 fps= 45 q=28.0 size=    1024kB time=00:00:04.00 bitrate=2097.2kbits/s speed=1.5x
  const frameMatch = trimmed.match(/frame=\s*(\d+)/i);
  if (frameMatch) {
    stats.currentFrame = parseInt(frameMatch[1], 10);
  }
  const fpsMatch = trimmed.match(/fps=\s*([\d\.]+)/i);
  if (fpsMatch) {
    stats.fps = parseFloat(fpsMatch[1]);
  }
  const speedMatch = trimmed.match(/speed=\s*([\d\.]+)x/i);
  if (speedMatch) {
    stats.speed = `${speedMatch[1]}x`;
  }
  const timeMatch = trimmed.match(/time=\s*([\d:\.]+)/i);
  if (timeMatch) {
    stats.time = timeMatch[1];
  }
  const bitrateMatch = trimmed.match(/bitrate=\s*([\d\.]+\s*\w+\/s)/i);
  if (bitrateMatch) {
    stats.bitrate = bitrateMatch[1];
  }

  // 3. Fallback stage markers if not already captured by [Progress]
  if (progress === undefined) {
    if (/fast parallel pre-processing|pre-processing/i.test(trimmed)) {
      message = trimmed.replace(/^\[\*\]\s*/, '');
    } else if (/encoding unified video|rendering \d+ video chunks|parallel segment engine/i.test(trimmed)) {
      message = trimmed.replace(/^\[\*\]\s*/, '');
    } else if (/assembling timeline segments/i.test(trimmed)) {
      progress = 96;
      message = 'Assembling timeline segments with zero re-encode...';
    } else if (/archiving \d+ video clips into zip package/i.test(trimmed)) {
      progress = 96;
      message = 'Archiving video clips into ZIP package...';
    } else if (/success! video generated|export complete|clips zip archive created/i.test(trimmed)) {
      progress = 100;
      message = 'Video compilation complete.';
    } else if (!message && trimmed.startsWith('[*]')) {
      message = trimmed.replace(/^\[\*\]\s*/, '');
    }
  }

  return { message, progress, stats };
}

function addLog(job: RenderJob, line: string): void {
  const trimmedLine = line.trim();
  if (!trimmedLine) return;
  job.logs = [...job.logs.slice(-39), trimmedLine];

  const parsed = parseStdoutLine(trimmedLine);
  let updatedProgress = job.progress;
  if (parsed.progress !== undefined) {
    updatedProgress = Math.max(job.progress, parsed.progress);
  }

  let updatedStats = job.stats ? { ...job.stats } : {};
  if (parsed.stats && Object.keys(parsed.stats).length > 0) {
    updatedStats = { ...updatedStats, ...parsed.stats };
  }

  const updatedMessage = parsed.message || job.message;

  updateJob(job, {
    message: updatedMessage,
    progress: updatedProgress,
    stats: Object.keys(updatedStats).length > 0 ? updatedStats : undefined,
  });
}

export async function createRenderJob(
  execution: RenderJobExecution
): Promise<RenderJob> {
  const now = new Date().toISOString();
  const queuePos = renderQueue.length + (runtime.__vttRenderJobRunning ? 1 : 0);
  const job: RenderJob = {
    id: randomUUID(),
    status: 'queued',
    progress: 0,
    message: queuePos > 0
      ? `Render queued (Position #${queuePos} in line). Waiting for current render...`
      : 'Render accepted. Starting the background encoder...',
    createdAt: now,
    updatedAt: now,
    logs: [`[Queue] Render accepted by server (Position #${queuePos + 1}).`],
    outputFileName: execution.outputFileName,
    destinationFolder: execution.destinationFolder,
    resolution: execution.resolution,
    exportMode: execution.exportMode,
    duration: execution.duration,
    slideCount: execution.slideCount,
  };
  await persistJob(job);
  activeRecords.set(job.id, job);
  renderQueue.push({ job, execution });
  scheduleNextRender();
  return job;
}

function scheduleNextRender(): void {
  if (runtime.__vttRenderJobRunning || renderQueue.length === 0) return;
  runtime.__vttRenderJobRunning = true;
  const next = renderQueue.shift();
  if (!next) {
    runtime.__vttRenderJobRunning = false;
    return;
  }

  setImmediate(() => {
    void runRenderJob(next.job, next.execution).finally(() => {
      runtime.__vttRenderJobRunning = false;
      scheduleNextRender();
    });
  });
}

async function runRenderJob(
  job: RenderJob,
  execution: RenderJobExecution
): Promise<void> {
  let stdoutBuffer = '';
  let stderrTail = '';

  try {
    const { saveRenderedVideo } = await import('./render-library');
    if (isJobCancelled(job)) return;
    updateJob(job, {
      status: 'running',
      progress: job.progress || 0,
      message: 'Compiling video in the background on the server...',
    });

    const { spawn } = await import('child_process');
    const child = spawn(execution.pythonExe, execution.args, {
      cwd: execution.cwd,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUNBUFFERED: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    activeChildren.set(job.id, child);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString('utf-8');
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) addLog(job, line);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString('utf-8')).slice(-12000);
    });

    await new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => {
        if (stdoutBuffer) addLog(job, stdoutBuffer);
        if (job.status === 'cancelled') {
          resolve();
        } else if (code === 0) {
          resolve();
        } else {
          reject(
            new Error(
              `Native renderer exited with code ${code ?? signal}. ${stderrTail || job.logs.slice(-5).join('\n')}`
            )
          );
        }
      });
    });

    if (job.status === 'cancelled') return;
    if (!fs.existsSync(execution.outputFilePath)) {
      throw new Error('Renderer finished without creating an output file.');
    }

    let savedDestinationPath: string | undefined;
    if (execution.destinationFolder && fs.existsSync(execution.destinationFolder)) {
      const extension = execution.isZip ? '.zip' : '.mp4';
      const requestedName = execution.outputFileName?.trim();
      const safeRequestedName = requestedName ? path.basename(requestedName) : '';
      const fileName = safeRequestedName
        ? safeRequestedName.endsWith(extension)
          ? safeRequestedName
          : `${safeRequestedName.replace(/\.(mp4|zip)$/i, '')}${extension}`
        : execution.isZip
          ? 'slideshow_clips.zip'
          : 'slideshow_video.mp4';
      savedDestinationPath = path.join(execution.destinationFolder, fileName);
      await fs.promises.copyFile(execution.outputFilePath, savedDestinationPath);
    }

    const renderedVideo = await saveRenderedVideo({
      tempVideoPath: execution.outputFilePath,
      duration: execution.duration,
      slideCount: execution.slideCount,
      resolution: execution.resolution,
      firstImagePath: execution.firstImagePath,
      isZip: execution.isZip,
      exportMode: execution.exportMode,
      title: execution.outputFileName || undefined,
      filename: execution.outputFileName || undefined,
    });

    updateJob(job, {
      status: 'completed',
      progress: 100,
      message: 'Render complete. The file is saved in the rendered videos library.',
      renderedVideo,
      savedDestinationPath,
    });
  } catch (error) {
    if (job.status !== 'cancelled') {
      const message =
        error instanceof Error ? error.message : 'Background render failed.';
      updateJob(job, {
        status: 'failed',
        message: `Background render failed: ${message}`,
        error: message,
        logs: [...job.logs.slice(-39), `[Error] ${message}`],
      });
    }
  } finally {
    activeChildren.delete(job.id);
    try {
      await fs.promises.rm(execution.tempDirPath, { recursive: true, force: true });
    } catch (error) {
      console.warn(`Could not clean up render job ${job.id}:`, error);
    }
    await persistJob(job).catch((error: unknown) => {
      console.error(`Could not finalize render job ${job.id}:`, error);
    });
    activeRecords.delete(job.id);
  }
}

export async function getRenderJob(id: string): Promise<RenderJob | null> {
  const active = activeRecords.get(id);
  if (active) return active;
  const filePath = getJobPath(id);
  if (!fs.existsSync(filePath)) return null;
  const content = await fs.promises.readFile(filePath, 'utf-8');
  const job = JSON.parse(content) as RenderJob;
  const isQueued = renderQueue.some((entry) => entry.job.id === job.id);
  const isRunning = activeChildren.has(job.id);
  if (isQueued || isRunning) {
    activeRecords.set(job.id, job);
    return job;
  }
  if (job.status === 'queued' || job.status === 'running') {
    Object.assign(job, {
      status: 'interrupted',
      message: 'Render process was interrupted when the server restarted.',
      error: 'The application server restarted while this render was running. You can safely retry this job.',
      updatedAt: new Date().toISOString(),
    });
    await persistJob(job);
  }
  return job;
}

export async function cancelRenderJob(id: string): Promise<boolean> {
  const job = activeRecords.get(id) ?? await getRenderJob(id);
  if (!job || (job.status !== 'queued' && job.status !== 'running')) return false;
  const queuedIndex = renderQueue.findIndex((entry) => entry.job.id === id);
  const queuedJob = queuedIndex >= 0 ? renderQueue.splice(queuedIndex, 1)[0] : null;
  const child = activeChildren.get(id);
  updateJob(job, {
    status: 'cancelled',
    message: 'Render cancelled by user.',
  });
  if (child) {
    terminateProcessTree(child);
  }
  if (queuedJob) {
    await fs.promises.rm(queuedJob.execution.tempDirPath, {
      recursive: true,
      force: true,
    });
  }
  await persistJob(job);
  if (queuedJob) activeRecords.delete(id);
  return true;
}

export async function deleteRenderJob(id: string): Promise<boolean> {
  const queuedIndex = renderQueue.findIndex((entry) => entry.job.id === id);
  if (queuedIndex >= 0) {
    const queuedJob = renderQueue.splice(queuedIndex, 1)[0];
    await fs.promises.rm(queuedJob.execution.tempDirPath, {
      recursive: true,
      force: true,
    }).catch(() => {});
  }
  const child = activeChildren.get(id);
  if (child) {
    try {
      terminateProcessTree(child);
    } catch {}
    activeChildren.delete(id);
  }
  activeRecords.delete(id);
  try {
    const filePath = getJobPath(id);
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
      return true;
    }
  } catch (err) {
    console.warn(`Could not delete job file for ${id}:`, err);
  }
  return true;
}

export async function clearFinishedRenderJobs(): Promise<number> {
  let cleared = 0;
  const dir = getJobsDir();
  try {
    if (fs.existsSync(dir)) {
      const files = await fs.promises.readdir(dir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const filePath = path.join(dir, file);
        try {
          const content = await fs.promises.readFile(filePath, 'utf-8');
          const job = JSON.parse(content) as RenderJob;
          if (
            job.status === 'completed' ||
            job.status === 'failed' ||
            job.status === 'cancelled'
          ) {
            await fs.promises.unlink(filePath).catch(() => {});
            activeRecords.delete(job.id);
            cleared++;
          }
        } catch {}
      }
    }
  } catch (err) {
    console.warn('Could not clear finished render jobs:', err);
  }
  return cleared;
}

export async function listRenderJobs(): Promise<RenderJob[]> {
  const jobsMap = new Map<string, RenderJob>();

  // 1. In-memory active records (queued & running)
  for (const [id, job] of activeRecords.entries()) {
    jobsMap.set(id, { ...job });
  }

  // 2. Read persisted job files from output/render_jobs
  try {
    const dir = getJobsDir();
    if (fs.existsSync(dir)) {
      const files = await fs.promises.readdir(dir);
      const jsonFiles = files.filter((f) => f.endsWith('.json')).slice(-50);
      for (const file of jsonFiles) {
        const id = file.replace(/\.json$/, '');
        if (!jobsMap.has(id)) {
          try {
            const content = await fs.promises.readFile(path.join(dir, file), 'utf-8');
            const job = JSON.parse(content) as RenderJob;
            const isQueued = renderQueue.some((entry) => entry.job.id === job.id);
            const isRunning = activeChildren.has(job.id);
            if (isQueued || isRunning) {
              activeRecords.set(job.id, job);
              jobsMap.set(id, job);
            } else {
              if (job.status === 'queued' || job.status === 'running') {
                job.status = 'interrupted';
                job.message = 'Render was interrupted when the server restarted.';
                job.error = 'The server restarted while this render was running. You can safely retry it.';
              }
              jobsMap.set(id, job);
            }
          } catch {}
        }
      }
    }
  } catch (err) {
    console.warn('Could not read persisted render jobs:', err);
  }

  const list = Array.from(jobsMap.values());
  list.sort((a, b) => {
    const order: Record<string, number> = { running: 0, queued: 1, completed: 2, interrupted: 3, failed: 4, cancelled: 5 };
    const orderA = order[a.status] ?? 99;
    const orderB = order[b.status] ?? 99;
    if (orderA !== orderB) return orderA - orderB;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return list;
}

export async function retryRenderJob(id: string): Promise<RenderJob | null> {
  const job = activeRecords.get(id) ?? await getRenderJob(id);
  if (!job) return null;
  if (job.status !== 'failed' && job.status !== 'interrupted' && job.status !== 'cancelled') {
    return job;
  }
  updateJob(job, {
    status: 'queued',
    progress: 0,
    error: undefined,
    message: 'Render re-queued for retry...',
    logs: [...job.logs.slice(-30), '[Retry] Job marked for retry.'],
  }, true);
  return job;
}

