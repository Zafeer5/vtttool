const { test, describe } = require('node:test');
const assert = require('node:assert');

// 1. Test Monotonic Progress & Job State Machine Logic
describe('Progress Lifecycle & Job State Machine', () => {
  class ProgressTracker {
    constructor() {
      this.currentJobId = null;
      this.highestPercent = 0;
      this.currentPercent = 0;
      this.status = 'idle';
      this.stage = 'idle';
      this.error = null;
    }

    setJob(jobId) {
      if (this.currentJobId !== jobId) {
        this.currentJobId = jobId;
        this.highestPercent = 0;
        this.currentPercent = 0;
        this.status = 'queued';
        this.stage = 'queued';
        this.error = null;
      }
    }

    updateProgress(jobId, rawPercent, stage) {
      // Reject stale events from older jobs
      if (jobId !== this.currentJobId) {
        return;
      }

      // Do not overwrite terminal states
      if (['completed', 'failed', 'cancelled', 'interrupted'].includes(this.status)) {
        return;
      }

      const isCompleted = stage === 'completed';
      const pct = isCompleted ? 100 : Math.max(this.highestPercent, Math.round(rawPercent));
      this.highestPercent = pct;
      this.currentPercent = pct;
      this.stage = stage;
      this.status = isCompleted ? 'completed' : stage === 'queued' ? 'queued' : 'rendering';
    }

    fail(jobId, errorMsg) {
      if (jobId !== this.currentJobId) return;
      this.status = 'failed';
      this.stage = 'error';
      this.error = errorMsg;
      // Preserves last achieved progress!
    }

    cancel(jobId) {
      if (jobId !== this.currentJobId) return;
      this.status = 'cancelled';
      this.stage = 'cancelled';
    }

    interrupt(jobId) {
      if (jobId !== this.currentJobId) return;
      this.status = 'interrupted';
      this.stage = 'interrupted';
    }
  }

  test('Render starts at zero and never has artificial 3% clamping', () => {
    const tracker = new ProgressTracker();
    tracker.setJob('job_1');
    assert.strictEqual(tracker.currentPercent, 0);
    assert.strictEqual(tracker.status, 'queued');
  });

  test('Progress increases monotonically within the same job', () => {
    const tracker = new ProgressTracker();
    tracker.setJob('job_1');
    tracker.updateProgress('job_1', 15, 'encoding');
    assert.strictEqual(tracker.currentPercent, 15);

    // If an anomalous non-monotonic update occurs, tracker holds highest
    tracker.updateProgress('job_1', 12, 'encoding');
    assert.strictEqual(tracker.currentPercent, 15);

    tracker.updateProgress('job_1', 45, 'encoding');
    assert.strictEqual(tracker.currentPercent, 45);
  });

  test('Switching jobs cleanly resets progress state and max percent', () => {
    const tracker = new ProgressTracker();
    tracker.setJob('job_1');
    tracker.updateProgress('job_1', 85, 'encoding');
    assert.strictEqual(tracker.currentPercent, 85);

    // Switch to job_2
    tracker.setJob('job_2');
    assert.strictEqual(tracker.currentPercent, 0, 'New job must reset to 0%');
    assert.strictEqual(tracker.highestPercent, 0, 'New job must reset highestPercent');
    assert.strictEqual(tracker.status, 'queued');

    tracker.updateProgress('job_2', 10, 'encoding');
    assert.strictEqual(tracker.currentPercent, 10, 'Must reflect job_2 actual progress, not job_1 85%');
  });

  test('Stale progress events from prior jobs are strictly rejected', () => {
    const tracker = new ProgressTracker();
    tracker.setJob('job_1');
    tracker.updateProgress('job_1', 50, 'encoding');

    tracker.setJob('job_2');
    tracker.updateProgress('job_2', 10, 'encoding');

    // Late event from job_1 arrives
    tracker.updateProgress('job_1', 99, 'encoding');
    assert.strictEqual(tracker.currentPercent, 10, 'Must NOT accept stale job_1 update');
  });

  test('Terminal states (failed/cancelled/interrupted) preserve last progress and resist stale events', () => {
    const tracker = new ProgressTracker();
    tracker.setJob('job_1');
    tracker.updateProgress('job_1', 65, 'encoding');
    tracker.fail('job_1', 'FFmpeg exited with error');

    assert.strictEqual(tracker.status, 'failed');
    assert.strictEqual(tracker.currentPercent, 65, 'Failed job must preserve last achieved progress');

    // Stale progress event arrives after failure
    tracker.updateProgress('job_1', 70, 'encoding');
    assert.strictEqual(tracker.status, 'failed', 'Terminal state must not be overwritten');
    assert.strictEqual(tracker.currentPercent, 65);
  });
});

// 2. Test ETA Computation
describe('ETA Calculation Engine', () => {
  function computeEta(currentFrame, totalFrames, fps) {
    if (!currentFrame || !totalFrames || !fps || fps <= 0 || currentFrame <= 0) {
      return null;
    }
    const remainingFrames = Math.max(0, totalFrames - currentFrame);
    const remainingSeconds = remainingFrames / fps;
    const mins = Math.floor(remainingSeconds / 60);
    const secs = Math.floor(remainingSeconds % 60);
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  }

  test('Returns null if insufficient telemetry', () => {
    assert.strictEqual(computeEta(0, 1000, 30), null);
    assert.strictEqual(computeEta(100, 1000, 0), null);
    assert.strictEqual(computeEta(100, 0, 30), null);
  });

  test('Computes accurate seconds remaining', () => {
    // 600 frames remaining at 30 fps = 20s
    assert.strictEqual(computeEta(400, 1000, 30), '20s');
  });

  test('Computes accurate minutes and seconds remaining', () => {
    // 3600 frames remaining at 30 fps = 120s = 2m 0s
    assert.strictEqual(computeEta(0, 3600, 30), null); // frame 0 is null
    assert.strictEqual(computeEta(300, 3900, 30), '2m 0s');
    // 150s remaining = 2m 30s
    assert.strictEqual(computeEta(300, 4800, 30), '2m 30s');
  });
});

// 3. Test VTT Validation Logic
describe('VTT Cue Validation', () => {
  function validateCues(cues, audioDuration) {
    const issues = [];
    if (!cues || cues.length === 0) {
      return { isValid: false, issues: [{ type: 'error', message: 'No subtitle cues found.' }] };
    }

    for (let i = 0; i < cues.length; i++) {
      const cue = cues[i];
      if (cue.end <= cue.start) {
        issues.push({ type: 'error', message: `Cue #${i + 1} has non-positive duration.` });
      }
      if (i > 0 && cue.start < cues[i - 1].start) {
        issues.push({ type: 'error', message: `Cue #${i + 1} starts before Cue #${i}.` });
      }
      if (i > 0 && cue.start < cues[i - 1].end) {
        issues.push({ type: 'warning', message: `Cue #${i + 1} overlaps with Cue #${i}.` });
      }
      if (!cue.text || cue.text.trim().length === 0) {
        issues.push({ type: 'warning', message: `Cue #${i + 1} has empty text.` });
      }
    }

    if (audioDuration && audioDuration > 0) {
      const lastCue = cues[cues.length - 1];
      if (lastCue && lastCue.end > audioDuration + 1.0) {
        issues.push({ type: 'warning', message: 'Subtitles extend beyond voiceover duration.' });
      }
    }

    return {
      isValid: !issues.some((i) => i.type === 'error'),
      issues,
    };
  }

  test('Valid cues pass with zero errors', () => {
    const cues = [
      { start: 0, end: 3, text: 'Hello world' },
      { start: 3, end: 6, text: 'Second slide' },
    ];
    const res = validateCues(cues, 10);
    assert.strictEqual(res.isValid, true);
    assert.strictEqual(res.issues.length, 0);
  });

  test('Detects negative or zero cue duration', () => {
    const cues = [{ start: 5, end: 4, text: 'Invalid time' }];
    const res = validateCues(cues);
    assert.strictEqual(res.isValid, false);
    assert.ok(res.issues.some((i) => i.type === 'error' && i.message.includes('non-positive duration')));
  });

  test('Detects out-of-order cues', () => {
    const cues = [
      { start: 5, end: 8, text: 'First' },
      { start: 2, end: 4, text: 'Second' },
    ];
    const res = validateCues(cues);
    assert.strictEqual(res.isValid, false);
    assert.ok(res.issues.some((i) => i.type === 'error' && i.message.includes('starts before')));
  });

  test('Flags overlapping cues as actionable warning', () => {
    const cues = [
      { start: 0, end: 5, text: 'First' },
      { start: 4, end: 8, text: 'Second' },
    ];
    const res = validateCues(cues);
    assert.strictEqual(res.isValid, true);
    assert.ok(res.issues.some((i) => i.type === 'warning' && i.message.includes('overlaps')));
  });

  test('Flags cues exceeding voiceover duration as warning', () => {
    const cues = [{ start: 0, end: 15, text: 'Slide' }];
    const res = validateCues(cues, 10); // audio is 10s, cues end at 15s
    assert.strictEqual(res.isValid, true);
    assert.ok(res.issues.some((i) => i.type === 'warning' && i.message.includes('extend beyond voiceover')));
  });
});
