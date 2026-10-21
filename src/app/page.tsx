'use client';

import React, { useState, useMemo, useRef, useSyncExternalStore, useEffect, useCallback } from 'react';
import confetti from 'canvas-confetti';
import {
  Mic,
  FileText,
  ImageIcon,
  Film,
  Play,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Zap,
  RefreshCw,
  Download,
  ArrowRight,
  ArrowLeft,
  Layers,
  Settings2,
  Sliders,
  FolderOpen,
  HardDrive,
  Archive,
  FolderArchive,
  X,
} from 'lucide-react';
import { Header } from '@/components/Header';
import { VoiceoverUploader } from '@/components/VoiceoverUploader';
import { ParagraphMatchStep } from '@/components/ParagraphMatchStep';
import { ImageSyncLiveStep } from '@/components/ImageSyncLiveStep';
import { TimelineEditor } from '@/components/TimelineEditor';
import { VideoProgressModal } from '@/components/VideoProgressModal';
import { VideoPreviewPlayer } from '@/components/VideoPreviewPlayer';
import { PythonScriptModal } from '@/components/PythonScriptModal';
import { RenderedVideosModal } from '@/components/RenderedVideosModal';
import { ProjectsSidebar } from '@/components/ProjectsSidebar';
import { RenderQueueSidebar } from '@/components/RenderQueueSidebar';
import { UnifiedProjectWorkspace } from '@/components/UnifiedProjectWorkspace';

import {
  VttCue,
  ScriptParagraph,
  ImageItem,
  SyncAnalysis,
  RenderProgress,
  SyncMatch,
  MotionSettings,
  DEFAULT_MOTION_SETTINGS,
  LogoSettings,
  DEFAULT_LOGO_SETTINGS,
  ParallelTranscripts,
  ExportMode,
  QueueRenderItem,
  ProjectItem,
} from '@/lib/types';
import { VideoResolution } from '@/lib/image-helper';
import { parseScript, ScriptSplitMode } from '@/lib/script-parser';
import { parseVtt } from '@/lib/vtt-parser';
import { synchronizeScriptAndVtt } from '@/lib/matcher';
import { generateSlideshowVideo } from '@/lib/ffmpeg-service';
import { withClipZoomMetadata } from '@/lib/motion';
import { saveRenderedBlob, getRenderedBlob, deleteRenderedBlob } from '@/lib/browser-storage';

const ZOOM_EFFECT_STORAGE_KEY = 'vtttool.zoomEffectEnabled.v2';
const ZOOM_INTENSITY_STORAGE_KEY = 'vtttool.zoomIntensity.v2';
const ZOOM_DIRECTION_STORAGE_KEY = 'vtttool.zoomDirection.v2';
const QUEUE_STORAGE_KEY = 'vtttool.renderQueue.v3';
const OUTPUT_FILENAME_STORAGE_KEY = 'vtttool.outputFileName.v3';
const ZOOM_EFFECT_CHANGE_EVENT = 'vtttool:zoom-effect-preference';
let warnedAboutZoomPreferenceRead = false;

interface QueuedJobPayload {
  matchesSnapshot: SyncMatch[];
  motionSnapshot: MotionSettings;
  logoSnapshot: LogoSettings;
  durationSnapshot: number;
  resolutionSnapshot: VideoResolution;
  folderSnapshot: string;
  autoDownloadSnapshot: boolean;
  audioFileSnapshot: File | null;
  exportModeSnapshot: ExportMode;
  cleanFileName: string;
}

function subscribeToZoomPreference(onChange: () => void): () => void {
  window.addEventListener('storage', onChange);
  window.addEventListener(ZOOM_EFFECT_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(ZOOM_EFFECT_CHANGE_EVENT, onChange);
  };
}

function getZoomPreferenceSnapshot(): boolean {
  try {
    const savedPreference = window.localStorage.getItem(ZOOM_EFFECT_STORAGE_KEY);
    if (savedPreference === 'true' || savedPreference === 'false') {
      return savedPreference === 'true';
    }
  } catch (error) {
    if (!warnedAboutZoomPreferenceRead) {
      console.warn('Could not read the saved zoom effect preference:', error);
      warnedAboutZoomPreferenceRead = true;
    }
  }
  return DEFAULT_MOTION_SETTINGS.zoomEnabled;
}

function getSavedMotionSettingsSnapshot(): Partial<MotionSettings> {
  if (typeof window === 'undefined') return {};
  try {
    const intensity = window.localStorage.getItem(ZOOM_INTENSITY_STORAGE_KEY);
    const direction = window.localStorage.getItem(ZOOM_DIRECTION_STORAGE_KEY);
    return {
      zoomIntensity: intensity ? parseFloat(intensity) || DEFAULT_MOTION_SETTINGS.zoomIntensity : DEFAULT_MOTION_SETTINGS.zoomIntensity,
      zoomDirection: (direction === 'in' || direction === 'out' || direction === 'random') ? direction : 'random',
    };
  } catch {
    return {};
  }
}

const PROJECTS_STORAGE_KEY = 'vtttool_projects_store_v2';
const ACTIVE_PROJECT_ID_KEY = 'vtttool_active_project_id_v2';

function createInitialProject(id: string = `proj_${Date.now()}`, name: string = 'Project 1'): ProjectItem {
  return {
    id,
    name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    activeStep: 1,
    rawScript: '',
    scriptSplitMode: 'paragraph',
    rawVtt: '',
    images: [],
    selectedResolution: '1080p',
    exportMode: 'single',
    outputFileName: `${name.replace(/\s+/g, '_')}_video.mp4`,
    selectedFolder: '',
    autoDownloadEnabled: false,
    motionSettings: DEFAULT_MOTION_SETTINGS,
    logoSettings: DEFAULT_LOGO_SETTINGS,
    cues: [],
    paragraphs: [],
  };
}

function loadSavedProjects(): ProjectItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(PROJECTS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (err) {
    console.warn('Could not parse saved projects:', err);
  }
  return [];
}

export default function Home() {
  // Multi-Project Studio State
  const [projects, setProjects] = useState<ProjectItem[]>(() => {
    const saved = loadSavedProjects();
    if (saved.length > 0) return saved;
    return [createInitialProject()];
  });

  const [activeProjectId, setActiveProjectId] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const savedActiveId = window.localStorage.getItem(ACTIVE_PROJECT_ID_KEY);
      if (savedActiveId && projects.some((p) => p.id === savedActiveId)) {
        return savedActiveId;
      }
    }
    return projects[0]?.id || `proj_${Date.now()}`;
  });

  const sessionFilesCacheRef = useRef<Map<string, {
    voiceoverFile: File | null;
    imageFiles: Map<string, File>;
  }>>(new Map());

  const [previewModalItem, setPreviewModalItem] = useState<QueueRenderItem | null>(null);

  // Stepper Flow (1: Voiceover -> 2: Paragraph Match -> 3: Images & Live Sync -> 4: Timeline Studio -> 5: Final Render)
  const [activeStep, setActiveStep] = useState<number>(1);

  // Audio & 3 Parallel Transcripts
  const [voiceoverFile, setVoiceoverFile] = useState<File | null>(null);
  const [voiceoverUrl, setVoiceoverUrl] = useState<string | null>(null);
  const [rawVtt, setRawVtt] = useState<string>('');
  const [cues, setCues] = useState<VttCue[]>([]);
  const [parallelTranscripts, setParallelTranscripts] = useState<ParallelTranscripts | null>(null);

  // Script & Paragraphs
  const [rawScript, setRawScript] = useState<string>('');
  const [scriptSplitMode, setScriptSplitMode] = useState<ScriptSplitMode>('paragraph');
  const [paragraphs, setParagraphs] = useState<ScriptParagraph[]>([]);

  // Images
  const [images, setImages] = useState<ImageItem[]>([]);

  // Motion settings, including the persistent per-image Ken Burns toggle & customizable zoom level.
  const [motionSettings, setMotionSettings] = useState<MotionSettings>(() => {
    const saved = getSavedMotionSettingsSnapshot();
    return {
      ...DEFAULT_MOTION_SETTINGS,
      zoomIntensity: saved.zoomIntensity ?? DEFAULT_MOTION_SETTINGS.zoomIntensity,
      zoomDirection: saved.zoomDirection ?? DEFAULT_MOTION_SETTINGS.zoomDirection,
    };
  });
  const zoomEffectEnabled = useSyncExternalStore(
    subscribeToZoomPreference,
    getZoomPreferenceSnapshot,
    () => DEFAULT_MOTION_SETTINGS.zoomEnabled
  );
  const activeMotionSettings = useMemo(
    () => ({ ...motionSettings, zoomEnabled: zoomEffectEnabled }),
    [motionSettings, zoomEffectEnabled]
  );

  const updateMotionSettings = (settings: MotionSettings) => {
    setMotionSettings(settings);
    try {
      window.localStorage.setItem(
        ZOOM_EFFECT_STORAGE_KEY,
        String(settings.zoomEnabled)
      );
      window.localStorage.setItem(
        ZOOM_INTENSITY_STORAGE_KEY,
        String(settings.zoomIntensity ?? DEFAULT_MOTION_SETTINGS.zoomIntensity)
      );
      window.localStorage.setItem(
        ZOOM_DIRECTION_STORAGE_KEY,
        settings.zoomDirection || 'random'
      );
    } catch (error) {
      console.warn('Could not save the zoom effect preference:', error);
    }
    window.dispatchEvent(new Event(ZOOM_EFFECT_CHANGE_EVENT));
  };

  useEffect(() => {
    const handleSync = () => {
      const saved = getSavedMotionSettingsSnapshot();
      setMotionSettings((prev) => ({
        ...prev,
        zoomIntensity: saved.zoomIntensity ?? prev.zoomIntensity,
        zoomDirection: saved.zoomDirection ?? prev.zoomDirection,
      }));
    };
    window.addEventListener('storage', handleSync);
    window.addEventListener(ZOOM_EFFECT_CHANGE_EVENT, handleSync);
    return () => {
      window.removeEventListener('storage', handleSync);
      window.removeEventListener(ZOOM_EFFECT_CHANGE_EVENT, handleSync);
    };
  }, []);

  // Logo Settings
  const [logoSettings, setLogoSettings] = useState<LogoSettings>(DEFAULT_LOGO_SETTINGS);

  // Custom Match Timeline Overrides
  const [customMatches, setCustomMatches] = useState<SyncMatch[] | null>(null);
  const [isTimelineLocked, setIsTimelineLocked] = useState<boolean>(true);

  // Render & Video Output States
  const [exportMode, setExportMode] = useState<ExportMode | null>(null);
  const [selectedResolution, setSelectedResolution] = useState<VideoResolution>('1080p');
  const [showPythonModal, setShowPythonModal] = useState<boolean>(false);
  const [isRendering, setIsRendering] = useState<boolean>(false);
  const [voiceoverDuration, setVoiceoverDuration] = useState<number>(0);
  const [outputFileName, setOutputFileName] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const saved = window.localStorage.getItem(OUTPUT_FILENAME_STORAGE_KEY);
      if (saved && saved.trim()) return saved.trim();
    }
    return 'slideshow_video.mp4';
  });

  const handleOutputFileNameChange = (newName: string) => {
    setOutputFileName(newName);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(OUTPUT_FILENAME_STORAGE_KEY, newName);
      } catch {}
    }
  };

  const [selectedFolder, setSelectedFolder] = useState<string>('');
  const [isBrowsingFolder, setIsBrowsingFolder] = useState<boolean>(false);
  const [saveDirectoryHandle, setSaveDirectoryHandle] = useState<any | null>(null);
  const [saveLocationLabel, setSaveLocationLabel] = useState<string>('');
  const [autoDownloadEnabled, setAutoDownloadEnabled] = useState<boolean>(true);
  const [renderProgress, setRenderProgress] = useState<RenderProgress>({
    stage: 'idle',
    percentage: 0,
    message: '',
    logs: [],
  });
  const [outputBlob, setOutputBlob] = useState<Blob | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const renderAbortControllerRef = useRef<AbortController | null>(null);

  // Dedicated Render Queue State with browser storage persistence
  const [queueItems, setQueueItems] = useState<QueueRenderItem[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const raw = window.localStorage.getItem(QUEUE_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            return parsed.map((item: QueueRenderItem) => ({
              ...item,
              status: (item.status === 'rendering' || item.status === 'preparing') ? 'cancelled' : item.status,
              message: (item.status === 'rendering' || item.status === 'preparing') ? 'Session ended' : item.message,
            }));
          }
        }
      } catch (err) {
        console.warn('Could not load render queue from localStorage:', err);
      }
    }
    return [];
  });
  const [isQueueOpen, setIsQueueOpen] = useState<boolean>(true);
  const jobAbortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const queuedJobPayloadsRef = useRef<Map<string, QueuedJobPayload>>(new Map());
  const isProcessingQueueRef = useRef<boolean>(false);
  const [queueTrigger, setQueueTrigger] = useState<number>(0);

  // 24-Hour Exported Files Library State
  const [showLibraryModal, setShowLibraryModal] = useState<boolean>(false);
  const [libraryCount, setLibraryCount] = useState<number>(0);

  const fetchLibraryCount = useCallback(async () => {
    try {
      const resp = await fetch('/api/renders');
      const data = await resp.json();
      if (data.success && Array.isArray(data.videos)) {
        setLibraryCount(data.videos.length);
      }
    } catch (err) {
      console.warn('Could not fetch exported files count:', err);
    }
  }, []);

  useEffect(() => {
    fetchLibraryCount();
  }, [fetchLibraryCount]);

  // Persist queue items metadata to browser storage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const serializable = queueItems.map((item) => {
        const { outputBlob, ...rest } = item;
        return rest;
      });
      window.localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(serializable));
    } catch (err) {
      console.warn('Could not persist queue items to localStorage:', err);
    }
  }, [queueItems]);

  // Hydrate completed queue item blobs from IndexedDB browser storage
  useEffect(() => {
    let isMounted = true;
    const hydrateBlobs = async () => {
      const completedWithoutBlob = queueItems.filter(
        (q) => q.status === 'completed' && !q.outputBlob
      );
      if (completedWithoutBlob.length === 0) return;

      for (const item of completedWithoutBlob) {
        try {
          const blob = await getRenderedBlob(item.id);
          if (blob && isMounted) {
            setQueueItems((prev) =>
              prev.map((q) => (q.id === item.id ? { ...q, outputBlob: blob } : q))
            );
          }
        } catch (e) {
          console.warn('Could not hydrate blob from IndexedDB:', e);
        }
      }
    };
    hydrateBlobs();
    return () => {
      isMounted = false;
    };
  }, [queueItems.length]);

  // Persist projects and activeProjectId to localStorage
  useEffect(() => {
    try {
      window.localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects));
      window.localStorage.setItem(ACTIVE_PROJECT_ID_KEY, activeProjectId);
    } catch (err) {
      console.warn('Could not save projects to localStorage:', err);
    }
  }, [projects, activeProjectId]);

  // Sync active project state
  useEffect(() => {
    if (!activeProjectId) return;
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id === activeProjectId) {
          return {
            ...p,
            updatedAt: Date.now(),
            activeStep,
            rawScript,
            scriptSplitMode,
            rawVtt,
            voiceoverFileName: voiceoverFile?.name || p.voiceoverFileName,
            voiceoverDuration,
            voiceoverUrl,
            images,
            selectedResolution,
            exportMode: exportMode || 'single',
            outputFileName,
            selectedFolder,
            autoDownloadEnabled,
            motionSettings: activeMotionSettings,
            logoSettings,
            cues,
            paragraphs,
            parallelTranscripts,
          };
        }
        return p;
      })
    );
  }, [
    activeProjectId,
    activeStep,
    rawScript,
    scriptSplitMode,
    rawVtt,
    voiceoverFile?.name,
    voiceoverDuration,
    voiceoverUrl,
    images,
    selectedResolution,
    exportMode,
    outputFileName,
    selectedFolder,
    autoDownloadEnabled,
    activeMotionSettings,
    logoSettings,
    cues,
    paragraphs,
    parallelTranscripts,
  ]);

  // Session file cache
  useEffect(() => {
    if (!activeProjectId) return;
    const imgMap = new Map<string, File>();
    images.forEach((img) => {
      if (img.file) imgMap.set(img.id, img.file);
    });
    sessionFilesCacheRef.current.set(activeProjectId, {
      voiceoverFile,
      imageFiles: imgMap,
    });
  }, [activeProjectId, voiceoverFile, images]);

  const handleSwitchProject = (targetProjectId: string) => {
    if (targetProjectId === activeProjectId) return;

    // Save current session files
    const imgMap = new Map<string, File>();
    images.forEach((img) => {
      if (img.file) imgMap.set(img.id, img.file);
    });
    sessionFilesCacheRef.current.set(activeProjectId, {
      voiceoverFile,
      imageFiles: imgMap,
    });

    const targetProj = projects.find((p) => p.id === targetProjectId);
    if (!targetProj) return;

    setActiveProjectId(targetProjectId);
    setActiveStep(targetProj.activeStep || 1);
    setRawScript(targetProj.rawScript || '');
    setScriptSplitMode(targetProj.scriptSplitMode || 'paragraph');
    setRawVtt(targetProj.rawVtt || '');
    setCues(targetProj.cues || []);
    setParagraphs(targetProj.paragraphs || []);
    setParallelTranscripts(targetProj.parallelTranscripts || null);
    setSelectedResolution((targetProj.selectedResolution as VideoResolution) || '1080p');
    setExportMode(targetProj.exportMode || 'single');
    setOutputFileName(targetProj.outputFileName || `${targetProj.name.replace(/\s+/g, '_')}_video.mp4`);
    setSelectedFolder(targetProj.selectedFolder || '');
    setAutoDownloadEnabled(!!targetProj.autoDownloadEnabled);
    if (targetProj.motionSettings) {
      setMotionSettings(targetProj.motionSettings);
    }
    if (targetProj.logoSettings) {
      setLogoSettings(targetProj.logoSettings);
    }
    setVoiceoverDuration(targetProj.voiceoverDuration || 0);
    setVoiceoverUrl(targetProj.voiceoverUrl || null);

    // Restore files from session cache
    const cachedFiles = sessionFilesCacheRef.current.get(targetProjectId);
    setVoiceoverFile(cachedFiles?.voiceoverFile || null);

    const restoredImages = (targetProj.images || []).map((img) => ({
      ...img,
      file: cachedFiles?.imageFiles.get(img.id) || img.file,
    }));
    setImages(restoredImages);

    setOutputBlob(null);
    setOutputUrl(null);
  };

  const handleCreateProject = () => {
    const imgMap = new Map<string, File>();
    images.forEach((img) => {
      if (img.file) imgMap.set(img.id, img.file);
    });
    sessionFilesCacheRef.current.set(activeProjectId, {
      voiceoverFile,
      imageFiles: imgMap,
    });

    const newNum = projects.length + 1;
    const newName = `Project ${newNum}`;
    const newId = `proj_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newProj = createInitialProject(newId, newName);

    setProjects((prev) => [...prev, newProj]);
    setActiveProjectId(newId);

    // Reset editor states
    setActiveStep(1);
    setVoiceoverFile(null);
    setVoiceoverUrl(null);
    setVoiceoverDuration(0);
    setRawVtt('');
    setCues([]);
    setParallelTranscripts(null);
    setRawScript('');
    setScriptSplitMode('paragraph');
    setParagraphs([]);
    setImages([]);
    setExportMode('single');
    setSelectedResolution('1080p');
    setOutputFileName(`${newName.replace(/\s+/g, '_')}_video.mp4`);
    setSelectedFolder('');
    setAutoDownloadEnabled(false);
    setOutputBlob(null);
    setOutputUrl(null);
    setRenderProgress({
      stage: 'idle',
      percentage: 0,
      message: '',
      logs: [],
    });
  };

  const handleDeleteProject = (projectIdToDelete: string) => {
    if (projects.length <= 1) {
      const fresh = createInitialProject(`proj_${Date.now()}`, 'Project 1');
      setProjects([fresh]);
      setActiveProjectId(fresh.id);
      setActiveStep(1);
      setVoiceoverFile(null);
      setVoiceoverUrl(null);
      setVoiceoverDuration(0);
      setRawVtt('');
      setCues([]);
      setParallelTranscripts(null);
      setRawScript('');
      setScriptSplitMode('paragraph');
      setParagraphs([]);
      setImages([]);
      setOutputBlob(null);
      setOutputUrl(null);
      sessionFilesCacheRef.current.clear();
      return;
    }

    const filtered = projects.filter((p) => p.id !== projectIdToDelete);
    sessionFilesCacheRef.current.delete(projectIdToDelete);

    if (activeProjectId === projectIdToDelete) {
      const nextProj = filtered[0];
      setProjects(filtered);
      handleSwitchProject(nextProj.id);
    } else {
      setProjects(filtered);
    }
  };

  const handleRenameProject = (projectId: string, newName: string) => {
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id === projectId) {
          return {
            ...p,
            name: newName,
            outputFileName: p.outputFileName.includes('slideshow') || p.outputFileName.includes('Project')
              ? `${newName.replace(/\s+/g, '_')}_video.mp4`
              : p.outputFileName,
          };
        }
        return p;
      })
    );
    if (activeProjectId === projectId) {
      setOutputFileName(`${newName.replace(/\s+/g, '_')}_video.mp4`);
    }
  };

  const handleDuplicateProject = (projectId: string) => {
    const orig = projects.find((p) => p.id === projectId);
    if (!orig) return;
    const newId = `proj_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const copy: ProjectItem = {
      ...orig,
      id: newId,
      name: `${orig.name} (Copy)`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setProjects((prev) => [...prev, copy]);
  };

  // Load existing / active jobs from server on startup and refresh
  const fetchServerJobs = useCallback(async () => {
    try {
      const resp = await fetch('/api/render', { cache: 'no-store' });
      if (!resp.ok) return;
      const data = await resp.json();
      if (data.success && Array.isArray(data.jobs)) {
        setQueueItems((prev) => {
          const prevMap = new Map(prev.map((i) => [i.serverJobId || i.id, i]));
          const merged: QueueRenderItem[] = [];
          const seenIds = new Set<string>();

          for (const sj of data.jobs) {
            seenIds.add(sj.id);
            const existing = prevMap.get(sj.id);
            const isRunning = sj.status === 'running';
            merged.push({
              id: existing ? existing.id : sj.id,
              serverJobId: sj.id,
              title: sj.outputFileName || existing?.title || (sj.exportMode === 'clips_zip' ? 'slideshow_clips.zip' : 'slideshow_video.mp4'),
              outputFileName: sj.outputFileName || existing?.outputFileName || '',
              exportMode: sj.exportMode || existing?.exportMode || 'single',
              resolution: sj.resolution || existing?.resolution || '1080p',
              slideCount: sj.slideCount || existing?.slideCount || 0,
              duration: sj.duration || existing?.duration || 0,
              createdAt: existing?.createdAt || new Date(sj.createdAt).getTime(),
              status: isRunning ? 'rendering' : sj.status,
              progress: typeof sj.progress === 'number' ? sj.progress : (existing?.progress || 0),
              message: sj.message || existing?.message || '',
              stats: sj.stats || existing?.stats,
              logs: Array.isArray(sj.logs) && sj.logs.length > 0 ? sj.logs : (existing?.logs || []),
              error: sj.error || existing?.error,
              outputUrl: sj.renderedVideo?.id ? `/api/renders/${sj.renderedVideo.id}` : existing?.outputUrl,
              downloadUrl: sj.renderedVideo?.id ? `/api/renders/${sj.renderedVideo.id}?download=1` : existing?.downloadUrl,
              outputSize: sj.renderedVideo?.fileSize || existing?.outputSize,
              savedDestinationPath: sj.savedDestinationPath || existing?.savedDestinationPath,
            });
          }

          // Keep any local preparing items
          for (const p of prev) {
            if (!seenIds.has(p.id) && (!p.serverJobId || !seenIds.has(p.serverJobId))) {
              merged.push(p);
            }
          }

          return merged;
        });
      }
    } catch (err) {
      console.warn('Could not load existing render jobs:', err);
    }
  }, []);

  useEffect(() => {
    fetchServerJobs();
    const interval = setInterval(fetchServerJobs, 6000);
    return () => clearInterval(interval);
  }, [fetchServerJobs]);

  // SSE subscription to stream live progress for any active / queued jobs
  useEffect(() => {
    const activeJobs = queueItems.filter(
      (q) => (q.status === 'rendering' || q.status === 'queued') && q.serverJobId
    );
    if (activeJobs.length === 0) return;

    const cleanups: (() => void)[] = [];

    for (const item of activeJobs) {
      const jobId = item.serverJobId!;
      if (typeof EventSource !== 'undefined') {
        try {
          const es = new EventSource(`/api/render/${jobId}/events`);
          es.onmessage = (event) => {
            try {
              const job = JSON.parse(event.data);
              setQueueItems((prev) =>
                prev.map((q) => {
                  if (q.serverJobId === jobId || q.id === jobId) {
                    return {
                      ...q,
                      status: job.status === 'running' ? 'rendering' : job.status,
                      progress: typeof job.progress === 'number' ? job.progress : q.progress,
                      message: job.message || q.message,
                      stats: job.stats || q.stats,
                      logs: Array.isArray(job.logs) ? job.logs : q.logs,
                      error: job.error,
                      outputUrl: job.renderedVideo?.id ? `/api/renders/${job.renderedVideo.id}` : q.outputUrl,
                      downloadUrl: job.renderedVideo?.id ? `/api/renders/${job.renderedVideo.id}?download=1` : q.downloadUrl,
                      outputSize: job.renderedVideo?.fileSize || q.outputSize,
                      savedDestinationPath: job.savedDestinationPath || q.savedDestinationPath,
                    };
                  }
                  return q;
                })
              );
              if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
                es.close();
                void fetchLibraryCount();
              }
            } catch {}
          };
          es.onerror = () => {
            es.close();
          };
          cleanups.push(() => es.close());
        } catch {}
      }
    }

    return () => {
      cleanups.forEach((c) => c());
    };
  }, [queueItems.map((q) => `${q.id}-${q.status}-${q.serverJobId}`).join(','), fetchLibraryCount]);

  // Compute live synchronization analysis whenever paragraphs, cues, images, or transcripts change
  const syncAnalysis: SyncAnalysis = useMemo(() => {
    if (paragraphs.length === 0 && cues.length === 0 && images.length === 0) {
      return {
        matches: [],
        hasMismatch: false,
        totalDuration: 0,
        imageCount: 0,
        paragraphCount: 0,
        cueCount: 0,
        matchedCount: 0,
      };
    }
    return synchronizeScriptAndVtt(paragraphs, cues, images, parallelTranscripts || undefined, voiceoverDuration);
  }, [paragraphs, cues, images, parallelTranscripts, voiceoverDuration]);

  // Compute active matches: user timeline edits take priority
  const activeMatches: SyncMatch[] = useMemo(() => {
    const matches =
      customMatches && customMatches.length === syncAnalysis.matches.length
        ? customMatches
        : syncAnalysis.matches;
    return withClipZoomMetadata(matches, activeMotionSettings.zoomDirection);
  }, [customMatches, syncAnalysis.matches, activeMotionSettings.zoomDirection]);

  const activeTotalDuration = useMemo(() => {
    if (activeMatches.length === 0) return 0;
    return activeMatches[activeMatches.length - 1].endTime;
  }, [activeMatches]);

  // Step 1: Voiceover & Subtitles Handlers
  const handleVoiceoverLoaded = (
    file: File | null,
    vttContent: string,
    parsedCues: VttCue[],
    audioDuration?: number,
    alignmentData?: any,
    threeTranscripts?: ParallelTranscripts
  ) => {
    if (file) {
      setVoiceoverFile(file);
      if (voiceoverUrl) {
        URL.revokeObjectURL(voiceoverUrl);
      }
      const newUrl = URL.createObjectURL(file);
      setVoiceoverUrl(newUrl);
    }
    if (audioDuration && audioDuration > 0) {
      setVoiceoverDuration(audioDuration);
    }
    setRawVtt(vttContent);
    setCues(parsedCues);

    if (threeTranscripts) {
      setParallelTranscripts(threeTranscripts);
    }

    setCustomMatches(null);
  };

  const handleVoiceoverCleared = () => {
    if (voiceoverUrl) {
      URL.revokeObjectURL(voiceoverUrl);
    }
    setVoiceoverFile(null);
    setVoiceoverUrl(null);
    setVoiceoverDuration(0);
    setRawVtt('');
    setCues([]);
    setParallelTranscripts(null);
    setCustomMatches(null);
  };

  const handleCuesUpdated = (updatedCues: VttCue[], updatedVtt: string) => {
    setCues(updatedCues);
    setRawVtt(updatedVtt);
    setCustomMatches(null);
  };

  // Step 2: Script Change & Multi-Script Match Handlers
  const handleScriptChange = (text: string, mode?: ScriptSplitMode) => {
    const activeMode = mode || scriptSplitMode;
    if (mode && mode !== scriptSplitMode) {
      setScriptSplitMode(mode);
    }
    setRawScript(text);
    const parsed = parseScript(text, activeMode);
    setParagraphs(parsed);
    setCustomMatches(null);
  };

  const handleVttChange = (text: string) => {
    setRawVtt(text);
    const parsed = parseVtt(text);
    setCues(parsed);
    if (parsed.length > 0) {
      const last = parsed[parsed.length - 1];
      if (last && last.endTime > 0) {
        setVoiceoverDuration(last.endTime);
      }
    }
    setCustomMatches(null);
  };

  const handleVoiceoverFileChange = (file: File | null) => {
    setVoiceoverFile(file);
    if (file) {
      const url = URL.createObjectURL(file);
      setVoiceoverUrl(url);
      const audio = new Audio(url);
      audio.onloadedmetadata = () => {
        if (audio.duration && !isNaN(audio.duration) && audio.duration > 0) {
          setVoiceoverDuration(audio.duration);
        }
      };
    } else {
      setVoiceoverUrl(null);
    }
  };

  const handleUpdateSlideDuration = (index: number, newDuration: number) => {
    setCustomMatches((prevMatches) => {
      const current = prevMatches ? [...prevMatches] : [...activeMatches];
      if (index >= 0 && index < current.length) {
        const diff = newDuration - current[index].duration;
        current[index] = {
          ...current[index],
          duration: newDuration,
          endTime: current[index].startTime + newDuration,
        };
        for (let j = index + 1; j < current.length; j++) {
          current[j] = {
            ...current[j],
            startTime: current[j].startTime + diff,
            endTime: current[j].endTime + diff,
          };
        }
      }
      return current;
    });
  };

  const handleClearScript = () => {
    setRawScript('');
    setParagraphs([]);
    setCustomMatches(null);
  };

  const handleRunMatch = () => {
    if (paragraphs.length === 0) return;
    const result = synchronizeScriptAndVtt(paragraphs, cues, images, parallelTranscripts || undefined);
    setCustomMatches(result.matches);
  };

  // Step 3: Images & Live Sync Handlers
  const handleImagesChange = (newImages: ImageItem[]) => {
    setImages(newImages);
  };

  const handleClearImages = () => {
    images.forEach((img) => {
      if (img.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(img.previewUrl);
      }
    });
    setImages([]);
  };

  const handleSendToTimeline = () => {
    // Lock timings and transition to Step 4 (Full CapCut / Filmora Timeline Editor)
    setIsTimelineLocked(false);
    setActiveStep(4);
    setTimeout(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 100);
  };

  // Reset entire project
  const handleResetAll = () => {
    handleVoiceoverCleared();
    handleClearScript();
    handleClearImages();
    setCustomMatches(null);
    setIsTimelineLocked(true);
    updateMotionSettings(DEFAULT_MOTION_SETTINGS);
    setLogoSettings(DEFAULT_LOGO_SETTINGS);
    if (outputUrl) {
      URL.revokeObjectURL(outputUrl);
      setOutputUrl(null);
      setOutputBlob(null);
    }
    setExportMode(null);
    setActiveStep(1);
    setRenderProgress({
      stage: 'idle',
      percentage: 0,
      message: '',
      logs: [],
    });
  };

  // Browse save location: Opens native system folder picker
  const handleBrowseSaveLocation = async () => {
    setIsBrowsingFolder(true);
    try {
      // 1. Try native desktop folder dialog via local server API
      const resp = await fetch('/api/browse-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initialDir: selectedFolder || '' }),
      });
      const data = await resp.json();
      if (data.success && data.folderPath) {
        setSelectedFolder(data.folderPath);
        setSaveLocationLabel(data.folderPath);
        setSaveDirectoryHandle(null);
        return;
      }
      if (data.cancelled) {
        return;
      }
    } catch (apiErr) {
      console.warn('Backend browse-folder fallback to browser picker:', apiErr);
    } finally {
      setIsBrowsingFolder(false);
    }

    // 2. Browser directory picker (Chrome / Edge / Chromium)
    try {
      if (typeof window !== 'undefined' && 'showDirectoryPicker' in window) {
        const dirHandle = await (window as any).showDirectoryPicker();
        if (dirHandle) {
          setSaveDirectoryHandle(dirHandle);
          setSelectedFolder(dirHandle.name);
          setSaveLocationLabel(dirHandle.name);
          return;
        }
      }
    } catch (pickerErr: any) {
      if (pickerErr?.name !== 'AbortError') {
        console.warn('Browser directory picker error:', pickerErr);
      }
    }

    // 3. Fallback: prompt for folder path
    const manualPath = prompt(
      'Enter destination folder path on your computer:',
      selectedFolder || 'C:\\Users\\zafee\\Videos'
    );
    if (manualPath && manualPath.trim()) {
      setSelectedFolder(manualPath.trim());
      setSaveLocationLabel(manualPath.trim());
      setSaveDirectoryHandle(null);
    }
  };

  // Helper for triggering browser downloads with exact sanitized filename and memory cleanup
  const triggerBrowserFileDownload = (
    blob: Blob,
    fileName: string,
    apiUrl?: string | null,
    objectUrl?: string | null
  ) => {
    let sanitizedName = (fileName || 'slideshow_video.mp4').trim();
    const isZip = blob.type === 'application/zip' || sanitizedName.toLowerCase().endsWith('.zip');
    const ext = isZip ? '.zip' : '.mp4';
    if (!sanitizedName.toLowerCase().endsWith(ext)) {
      sanitizedName = `${sanitizedName.replace(/\.(mp4|zip)$/i, '')}${ext}`;
    }

    const downloadHref = apiUrl
      ? `${apiUrl}${apiUrl.includes('?') ? '&' : '?'}download=1&filename=${encodeURIComponent(sanitizedName)}`
      : (objectUrl || URL.createObjectURL(blob));
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = downloadHref;
    a.download = sanitizedName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      if (!apiUrl && !objectUrl) {
        URL.revokeObjectURL(downloadHref);
      }
    }, 1000);
  };

  // Step 5: Video Compilation - Enqueues task into the Sequential Queue
  // Tasks are added to the list and do NOT start until previous renders complete
  const handleGenerateVideo = async () => {
    if (!exportMode) {
      alert('Please select an export mode (Single Video or Clips ZIP Archive) before proceeding.');
      return;
    }

    if (activeMatches.length === 0) {
      alert('No slide matches found. Please make sure audio, script, and images are loaded.');
      return;
    }

    const missingSlideIndex = activeMatches.findIndex((m) => !m.image);
    if (missingSlideIndex !== -1) {
      alert(`Slide ${missingSlideIndex + 1} is missing an image. Please attach an image for each slide.`);
      return;
    }

    const queueId = `render_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const isZip = exportMode === 'clips_zip';
    const fileExt = isZip ? '.zip' : '.mp4';
    const defaultName = isZip ? 'slideshow_clips.zip' : 'slideshow_video.mp4';
    const baseName = outputFileName.trim().replace(/\.(mp4|zip)$/i, '');
    const cleanFileName = baseName.length > 0 ? `${baseName}${fileExt}` : defaultName;

    // Take immutable snapshots so subsequent timeline / settings changes don't affect this job
    const matchesSnapshot: SyncMatch[] = activeMatches.map((m) => ({
      ...m,
      image: m.image ? { ...m.image } : null,
    }));
    const motionSnapshot = { ...activeMotionSettings };
    const logoSnapshot = { ...logoSettings };
    const durationSnapshot = activeTotalDuration;
    const resolutionSnapshot = selectedResolution;
    const folderSnapshot = selectedFolder;
    const autoDownloadSnapshot = autoDownloadEnabled;
    const audioFileSnapshot = voiceoverFile;
    const exportModeSnapshot = exportMode;

    const payload: QueuedJobPayload = {
      matchesSnapshot,
      motionSnapshot,
      logoSnapshot,
      durationSnapshot,
      resolutionSnapshot,
      folderSnapshot,
      autoDownloadSnapshot,
      audioFileSnapshot,
      exportModeSnapshot,
      cleanFileName,
    };

    queuedJobPayloadsRef.current.set(queueId, payload);

    const currentProj = projects.find((p) => p.id === activeProjectId);
    const projPrefix = currentProj?.name ? `${currentProj.name} • ` : '';

    const newItem: QueueRenderItem = {
      id: queueId,
      title: `${projPrefix}${cleanFileName}`,
      outputFileName: cleanFileName,
      exportMode: exportModeSnapshot,
      resolution: resolutionSnapshot,
      slideCount: matchesSnapshot.length,
      duration: durationSnapshot,
      createdAt: Date.now(),
      status: 'queued',
      progress: 0,
      message: 'Queued (waiting in line)...',
      logs: ['[Queue] Task added to queue. Rendering will begin in sequence...'],
      autoDownload: true,
    };

    setQueueItems((prev) => [...prev, newItem]);
    setIsQueueOpen(true);
    setQueueTrigger((prev) => prev + 1);
  };

  // Dedicated Sequential Queue Worker: executes 1 job at a time, strictly sequentially
  useEffect(() => {
    // If a job is already actively rendering or preparing, DO NOT start another one
    const isAlreadyRendering = queueItems.some(
      (item) => item.status === 'rendering' || item.status === 'preparing'
    );
    if (isAlreadyRendering || isProcessingQueueRef.current) {
      return;
    }

    // Find the next waiting queued task in FIFO order
    const nextQueuedItem = queueItems.find((item) => item.status === 'queued');
    if (!nextQueuedItem) {
      return;
    }

    const payload = queuedJobPayloadsRef.current.get(nextQueuedItem.id);
    if (!payload) {
      setQueueItems((prev) =>
        prev.map((item) =>
          item.id === nextQueuedItem.id
            ? { ...item, status: 'failed', message: 'Task payload expired on page reload. Please retry.' }
            : item
        )
      );
      return;
    }

    isProcessingQueueRef.current = true;
    setIsRendering(true);

    // Transition this queued item to preparing
    setQueueItems((prev) =>
      prev.map((item) =>
        item.id === nextQueuedItem.id
          ? {
              ...item,
              status: 'preparing',
              progress: 3,
              message: 'Preparing timeline and media...',
              logs: ['[Init] Starting sequential video render...'],
            }
          : item
      )
    );

    // Execute the rendering job
    void runQueueItemExecution(nextQueuedItem.id, payload);
  }, [queueItems, queueTrigger]);

  const runQueueItemExecution = async (queueId: string, payload: QueuedJobPayload) => {
    const controller = new AbortController();
    jobAbortControllersRef.current.set(queueId, controller);
    renderAbortControllerRef.current = controller;

    setRenderProgress({
      stage: 'preparing',
      percentage: 3,
      message: 'Starting video compilation...',
      logs: ['[Init] Initializing render job...'],
      exportMode: payload.exportModeSnapshot,
    });

    let receivedApiUrl: string | null = null;
    let highestProgress = 3;

    try {
      const blob = await generateSlideshowVideo(payload.matchesSnapshot, {
        onProgress: (prog) => {
          if (prog.outputUrl) {
            receivedApiUrl = prog.outputUrl;
          }
          const rawPct = typeof prog.percentage === 'number' ? prog.percentage : 0;
          const isCompletedStage = prog.stage === 'completed';
          const clampedPct = isCompletedStage
            ? 100
            : Math.min(99, Math.max(highestProgress, Math.round(rawPct)));
          highestProgress = clampedPct;

          const monotonicProg: RenderProgress = {
            ...prog,
            percentage: clampedPct,
          };
          setRenderProgress(monotonicProg);

          setQueueItems((prev) =>
            prev.map((item) => {
              if (item.id === queueId || (prog.jobId && item.serverJobId === prog.jobId)) {
                return {
                  ...item,
                  serverJobId: prog.jobId || item.serverJobId,
                  status: isCompletedStage
                    ? 'completed'
                    : prog.stage === 'queued'
                    ? 'queued'
                    : 'rendering',
                  progress: clampedPct,
                  message: prog.message || item.message,
                  stats: prog.stats || item.stats,
                  logs: prog.logs ? [...prog.logs.slice(-30)] : item.logs,
                  outputBlob: prog.outputBlob || item.outputBlob,
                  outputUrl: prog.outputUrl || item.outputUrl,
                  downloadUrl: prog.outputUrl
                    ? `${prog.outputUrl}?download=1&filename=${encodeURIComponent(payload.cleanFileName)}`
                    : item.downloadUrl,
                  outputSize: prog.outputSize || item.outputSize,
                  savedDestinationPath: prog.savedDestinationPath || item.savedDestinationPath,
                };
              }
              return item;
            })
          );
        },
        resolution: payload.resolutionSnapshot,
        voiceoverFile: payload.audioFileSnapshot || undefined,
        motionSettings: payload.motionSnapshot,
        logoSettings: payload.logoSnapshot,
        signal: controller.signal,
        totalDuration: payload.durationSnapshot,
        destinationFolder: payload.folderSnapshot || undefined,
        outputFileName: payload.cleanFileName,
        exportMode: payload.exportModeSnapshot,
      });

      const blobApiUrl = (blob as any)?.outputUrl || receivedApiUrl;
      const videoObjectUrl = URL.createObjectURL(blob);
      const finalMappedUrl = blobApiUrl || videoObjectUrl;

      setOutputBlob(blob);
      setOutputUrl(finalMappedUrl);
      setRenderProgress((prev) => ({
        ...prev,
        stage: 'completed',
        percentage: 100,
        outputBlob: blob,
        outputUrl: finalMappedUrl,
        exportMode: payload.exportModeSnapshot,
      }));

      setQueueItems((prev) =>
        prev.map((item) => {
          if (item.id === queueId) {
            return {
              ...item,
              status: 'completed',
              progress: 100,
              message: 'Render complete! File downloaded.',
              outputBlob: blob,
              outputUrl: finalMappedUrl,
              downloadUrl: blobApiUrl
                ? `${blobApiUrl}?download=1&filename=${encodeURIComponent(payload.cleanFileName)}`
                : undefined,
              outputSize: blob.size,
            };
          }
          return item;
        })
      );

      // 1. Save binary Blob directly into IndexedDB for persistent caching without memory leaks or 5MB quota errors
      void saveRenderedBlob(queueId, blob);

      // 2. USER REQUIREMENT: "jese hi complete ho video download kardey."
      // Automatically trigger video download as soon as rendering completes
      triggerBrowserFileDownload(blob, payload.cleanFileName, blobApiUrl, videoObjectUrl);

      // Auto-save to local directory handle if configured
      if (saveDirectoryHandle) {
        try {
          const fileHandle = await saveDirectoryHandle.getFileHandle(payload.cleanFileName, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(blob);
          await writable.close();
          setQueueItems((prev) =>
            prev.map((item) =>
              item.id === queueId
                ? {
                    ...item,
                    savedDestinationPath: `${payload.folderSnapshot ? payload.folderSnapshot + '\\' : ''}${payload.cleanFileName}`,
                  }
                : item
            )
          );
        } catch (writeErr) {
          console.warn('Direct directory handle write error:', writeErr);
        }
      }

      try {
        confetti({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 },
        });
      } catch {}

      void fetchLibraryCount();
    } catch (err: any) {
      if (controller.signal.aborted) {
        setQueueItems((prev) =>
          prev.map((item) => (item.id === queueId ? { ...item, status: 'cancelled', message: 'Render cancelled.' } : item))
        );
      } else {
        console.error('Video generation error for job:', queueId, err);
        const errMsg = err?.message || 'Video compilation encountered an issue.';
        setQueueItems((prev) =>
          prev.map((item) =>
            item.id === queueId
              ? {
                  ...item,
                  status: 'failed',
                  error: errMsg,
                  message: `Failed: ${errMsg}`,
                  logs: [...item.logs, `[Error] Compilation failed: ${errMsg}`],
                }
              : item
          )
        );
        setRenderProgress((prev) => ({
          ...prev,
          stage: 'error',
          message: errMsg,
          logs: [...prev.logs, `[Error] Compilation failed: ${errMsg}`],
          error: errMsg,
        }));
      }
    } finally {
      jobAbortControllersRef.current.delete(queueId);
      queuedJobPayloadsRef.current.delete(queueId);
      isProcessingQueueRef.current = false;
      setIsRendering(false);
      setQueueTrigger((prev) => prev + 1);
    }
  };

  const handleCancelQueueItem = async (id: string) => {
    const controller = jobAbortControllersRef.current.get(id);
    if (controller) {
      controller.abort();
      jobAbortControllersRef.current.delete(id);
    }
    const item = queueItems.find((q) => q.id === id);
    if (item?.serverJobId) {
      try {
        await fetch(`/api/render/${item.serverJobId}`, { method: 'DELETE' });
      } catch (e) {
        console.warn('Could not cancel server render job:', e);
      }
    }
    setQueueItems((prev) =>
      prev.map((q) => (q.id === id ? { ...q, status: 'cancelled', message: 'Render cancelled by user.' } : q))
    );
    setQueueTrigger((prev) => prev + 1);
  };

  const handleDeleteQueueItem = async (id: string) => {
    const item = queueItems.find((q) => q.id === id);
    const targetId = item?.serverJobId || id;
    try {
      await fetch(`/api/render/${targetId}`, { method: 'DELETE' });
    } catch (e) {
      console.warn('Could not delete server render job:', e);
    }
    void deleteRenderedBlob(id);
    setQueueItems((prev) => prev.filter((q) => q.id !== id && q.serverJobId !== id));
  };

  const handleClearCompletedQueue = async () => {
    try {
      await fetch('/api/render?clear=finished', { method: 'DELETE' });
    } catch (e) {
      console.warn('Could not clear finished server render jobs:', e);
    }
    const completedItems = queueItems.filter((q) => q.status === 'completed');
    for (const c of completedItems) {
      void deleteRenderedBlob(c.id);
    }
    setQueueItems((prev) => prev.filter((q) => q.status === 'rendering' || q.status === 'queued' || q.status === 'preparing'));
  };

  const handleDownloadQueueItem = (item: QueueRenderItem) => {
    const isZip = item.exportMode === 'clips_zip';
    const fileExt = isZip ? '.zip' : '.mp4';
    const defaultName = isZip ? 'slideshow_clips.zip' : 'slideshow_video.mp4';
    const cleanName = item.outputFileName
      ? item.outputFileName.trim().toLowerCase().endsWith(fileExt)
        ? item.outputFileName.trim()
        : `${item.outputFileName.trim().replace(/\.(mp4|zip)$/i, '')}${fileExt}`
      : defaultName;

    if (item.downloadUrl || (item.outputUrl && item.outputUrl.startsWith('/api/renders/'))) {
      const baseDirectUrl = item.downloadUrl || `${item.outputUrl}?download=1`;
      const directUrl = `${baseDirectUrl}${baseDirectUrl.includes('?') ? '&' : '?'}filename=${encodeURIComponent(cleanName)}`;
      const a = document.createElement('a');
      a.href = directUrl;
      a.download = cleanName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    }

    if (item.outputBlob) {
      const url = URL.createObjectURL(item.outputBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = cleanName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      return;
    }
  };

  const handlePreviewQueueItem = (item: QueueRenderItem) => {
    if (item.outputBlob) {
      setOutputBlob(item.outputBlob);
    }
    if (item.outputUrl) {
      setOutputUrl(item.outputUrl);
      setTimeout(() => {
        document.getElementById('render-preview-section')?.scrollIntoView({ behavior: 'smooth' });
      }, 150);
    }
  };

  const handleDownloadAllCompleted = () => {
    const completed = queueItems.filter((q) => q.status === 'completed');
    completed.forEach((item, idx) => {
      setTimeout(() => {
        handleDownloadQueueItem(item);
      }, idx * 600);
    });
  };

  const handleRetryQueueItem = (_item: QueueRenderItem) => {
    handleGenerateVideo();
  };

  const handleCancelRender = () => {
    if (renderAbortControllerRef.current) {
      renderAbortControllerRef.current.abort();
      renderAbortControllerRef.current = null;
    }
    setIsRendering(false);
    setRenderProgress({
      stage: 'idle',
      percentage: 0,
      message: '',
      logs: [],
    });
  };



  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 text-slate-100 font-sans select-none">
      {/* Left Vertical Bar: Projects Sidebar */}
      <ProjectsSidebar
        projects={projects}
        activeProjectId={activeProjectId}
        onSelectProject={handleSwitchProject}
        onCreateProject={handleCreateProject}
        onDeleteProject={handleDeleteProject}
        onRenameProject={handleRenameProject}
        onDuplicateProject={handleDuplicateProject}
      />

      {/* Center Main Workspace */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-slate-950 text-slate-100">
        {/* Top Header */}
        <Header
          onOpenLibrary={() => setShowLibraryModal(true)}
          libraryCount={libraryCount}
          onOpenQueue={() => setIsQueueOpen((prev) => !prev)}
          isQueueOpen={isQueueOpen}
          queueCount={queueItems.length}
          activeRenderCount={queueItems.filter((i) => i.status === 'rendering' || i.status === 'preparing').length}
          activeProjectName={projects.find((p) => p.id === activeProjectId)?.name}
        />

        {/* Scrollable Studio Canvas */}
        <main className="flex-1 w-full overflow-y-auto p-4 sm:p-5 space-y-4">
          <UnifiedProjectWorkspace
            project={projects.find((p) => p.id === activeProjectId) || projects[0]}
            cues={cues}
            paragraphs={paragraphs}
            images={images}
            rawScript={rawScript}
            rawVtt={rawVtt}
            scriptSplitMode={scriptSplitMode}
            voiceoverFile={voiceoverFile}
            voiceoverUrl={voiceoverUrl}
            voiceoverDuration={voiceoverDuration}
            activeMatches={activeMatches}
            activeTotalDuration={activeTotalDuration}
            selectedResolution={selectedResolution}
            exportMode={exportMode || 'single'}
            outputFileName={outputFileName}
            selectedFolder={selectedFolder}
            autoDownloadEnabled={autoDownloadEnabled}
            motionSettings={activeMotionSettings}
            logoSettings={logoSettings}
            isRendering={isRendering}
            queueCount={queueItems.length}
            onScriptChange={(val) => handleScriptChange(val)}
            onSplitModeChange={(mode) => handleScriptChange(rawScript, mode)}
            onVttChange={handleVttChange}
            onVoiceoverFileChange={handleVoiceoverFileChange}
            onImagesChange={(newImgs) => setImages(newImgs)}
            onResolutionChange={(res) => setSelectedResolution(res)}
            onExportModeChange={(mode) => setExportMode(mode)}
            onOutputFileNameChange={handleOutputFileNameChange}
            onBrowseFolder={handleBrowseSaveLocation}
            onMotionSettingsChange={updateMotionSettings}
            onLogoSettingsChange={(settings) => setLogoSettings(settings)}
            onCompileAndQueue={handleGenerateVideo}
            onUpdateSlideDuration={handleUpdateSlideDuration}
          />

          {/* Video Player Output Section if active preview is set */}
          {outputUrl && outputBlob && (
            <div id="render-preview-section" className="mt-4 pt-4 border-t border-slate-800">
              <VideoPreviewPlayer
                videoBlob={outputBlob}
                videoUrl={outputUrl}
                videoDuration={activeTotalDuration}
                totalSlides={activeMatches.length}
                matches={activeMatches}
                resolution={selectedResolution}
                outputFileName={outputFileName}
                exportMode={exportMode || 'single'}
                onReset={handleResetAll}
              />
            </div>
          )}
        </main>
      </div>

      {/* Right Vertical Bar: Dedicated Render Queue Sidebar */}
      <RenderQueueSidebar
        items={queueItems}
        isCollapsed={!isQueueOpen}
        onToggleCollapse={() => setIsQueueOpen((prev) => !prev)}
        onCancelItem={handleCancelQueueItem}
        onDeleteItem={handleDeleteQueueItem}
        onClearCompleted={handleClearCompletedQueue}
        onDownloadItem={handleDownloadQueueItem}
        onPreviewItem={(item) => setPreviewModalItem(item)}
      />

      {/* Modal for Previewing Queue Video */}
      {previewModalItem && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl max-w-4xl w-full p-6 relative max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setPreviewModalItem(null)}
              className="absolute top-4 right-4 p-2 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
            <VideoPreviewPlayer
              videoBlob={previewModalItem.outputBlob || null}
              videoUrl={previewModalItem.outputUrl || previewModalItem.downloadUrl || null}
              videoDuration={previewModalItem.duration || 0}
              totalSlides={previewModalItem.slideCount || 0}
              resolution={previewModalItem.resolution}
              outputFileName={previewModalItem.outputFileName}
              exportMode={previewModalItem.exportMode}
              onReset={() => setPreviewModalItem(null)}
            />
          </div>
        </div>
      )}

      {/* Python Script CLI Modal */}
      <PythonScriptModal
        isOpen={showPythonModal}
        onClose={() => setShowPythonModal(false)}
        motionSettings={activeMotionSettings}
      />

      {/* 24-Hour Exported Files Modal */}
      <RenderedVideosModal
        isOpen={showLibraryModal}
        onClose={() => setShowLibraryModal(false)}
        onLibraryUpdated={fetchLibraryCount}
      />
    </div>
  );
}
