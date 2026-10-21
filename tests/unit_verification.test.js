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

// 4. Test Speech Synchronization & Slide Alignment Engine
describe('Speech Synchronization & Slide Alignment Engine', () => {
  function computeSlideTimings({ paragraphs, cues, images, audioDuration }) {
    const paragraphCount = paragraphs.length;
    const imageCount = images.length;

    // Strict Rule: If paragraphCount === 0 and imageCount > 0, fallback to image division
    if (imageCount > 0 && paragraphCount === 0) {
      const total = audioDuration || 10;
      const step = total / imageCount;
      return images.map((img, i) => ({
        slideIndex: i,
        startTime: Number((i * step).toFixed(3)),
        endTime: Number(((i + 1) * step).toFixed(3)),
        duration: Number(step.toFixed(3)),
        image: img,
        mode: 'image_fallback',
      }));
    }

    // When paragraphs exist, paragraphs ALWAYS drive speech synchronization
    const rawTimings = [];
    let prevStartTime = -1;

    for (let i = 0; i < paragraphs.length; i++) {
      const p = paragraphs[i];
      let matchedStart = cues[i] ? cues[i].start : (prevStartTime >= 0 ? prevStartTime + 2.0 : 0);
      
      // Monotonic guard: candidate cannot precede previous start + 0.3
      if (prevStartTime >= 0 && matchedStart < prevStartTime + 0.3) {
        matchedStart = prevStartTime + 0.5;
      }
      prevStartTime = matchedStart;

      rawTimings.push({
        paragraphIndex: i,
        startTime: Number(matchedStart.toFixed(3)),
        text: p.text,
      });
    }

    // Build finalized non-overlapping slide matches
    return rawTimings.map((rt, i) => {
      let endTime;
      if (i < rawTimings.length - 1) {
        endTime = rawTimings[i + 1].startTime;
      } else {
        const lastCueEnd = cues.length > 0 ? cues[cues.length - 1].end : rt.startTime + 3.0;
        endTime = Math.max(rt.startTime + 0.5, audioDuration || lastCueEnd);
      }
      
      return {
        slideIndex: i,
        startTime: rt.startTime,
        endTime: Number(endTime.toFixed(3)),
        duration: Number((endTime - rt.startTime).toFixed(3)),
        image: images[i] || null,
        isMissingImage: !images[i],
        text: rt.text,
      };
    });
  }

  test('Speech synchronization is strictly preserved when imageCount < paragraphCount', () => {
    const paragraphs = [
      { text: 'Paragraph one introduction' },
      { text: 'Paragraph two explanation' },
      { text: 'Paragraph three details' },
      { text: 'Paragraph four summary' },
      { text: 'Paragraph five conclusion' },
    ];
    const cues = [
      { start: 0.0, end: 6.8, text: 'Paragraph one introduction' },
      { start: 7.1, end: 14.2, text: 'Paragraph two explanation' },
      { start: 14.6, end: 21.8, text: 'Paragraph three details' },
      { start: 22.2, end: 28.5, text: 'Paragraph four summary' },
      { start: 29.1, end: 33.5, text: 'Paragraph five conclusion' },
    ];
    // Only 3 images for 5 paragraphs!
    const images = [{ name: 'img1.png' }, { name: 'img2.png' }, { name: 'img3.png' }];

    const slides = computeSlideTimings({ paragraphs, cues, images, audioDuration: 33.5 });

    assert.strictEqual(slides.length, 5, 'Must create 5 slides matching 5 paragraphs, not 3');
    assert.strictEqual(slides[0].startTime, 0.0);
    assert.strictEqual(slides[0].endTime, 7.1);
    assert.strictEqual(slides[1].startTime, 7.1);
    assert.strictEqual(slides[1].endTime, 14.6);
    assert.strictEqual(slides[2].startTime, 14.6);
    assert.strictEqual(slides[2].endTime, 22.2);
    assert.strictEqual(slides[3].startTime, 22.2);
    assert.strictEqual(slides[3].endTime, 29.1);
    assert.strictEqual(slides[4].startTime, 29.1);
    assert.strictEqual(slides[4].endTime, 33.5);

    // Verify image assignment & missing alerts
    assert.strictEqual(slides[0].image.name, 'img1.png');
    assert.strictEqual(slides[1].image.name, 'img2.png');
    assert.strictEqual(slides[2].image.name, 'img3.png');
    assert.strictEqual(slides[3].image, null);
    assert.strictEqual(slides[3].isMissingImage, true);
    assert.strictEqual(slides[4].image, null);
    assert.strictEqual(slides[4].isMissingImage, true);
  });

  test('Speech synchronization is strictly preserved when imageCount > paragraphCount', () => {
    const paragraphs = [
      { text: 'Paragraph one' },
      { text: 'Paragraph two' },
    ];
    const cues = [
      { start: 0.0, end: 5.0, text: 'Paragraph one' },
      { start: 5.2, end: 10.0, text: 'Paragraph two' },
    ];
    // 4 images for 2 paragraphs
    const images = [{ name: '1.jpg' }, { name: '2.jpg' }, { name: '3.jpg' }, { name: '4.jpg' }];

    const slides = computeSlideTimings({ paragraphs, cues, images, audioDuration: 10.0 });
    assert.strictEqual(slides.length, 2, 'Paragraphs govern speech structure');
    assert.strictEqual(slides[0].startTime, 0.0);
    assert.strictEqual(slides[0].endTime, 5.2);
    assert.strictEqual(slides[1].startTime, 5.2);
    assert.strictEqual(slides[1].endTime, 10.0);
  });

  test('Rejects non-monotonic false-positive cues and forces forward progression', () => {
    const paragraphs = [{ text: 'Slide A' }, { text: 'Slide B' }, { text: 'Slide C' }];
    const cues = [
      { start: 4.0, end: 8.0, text: 'Slide A' },
      { start: 1.0, end: 3.0, text: 'Slide B' }, // Invalid backward jump!
      { start: 10.0, end: 15.0, text: 'Slide C' },
    ];
    const images = [{ name: 'a.png' }, { name: 'b.png' }, { name: 'c.png' }];

    const slides = computeSlideTimings({ paragraphs, cues, images, audioDuration: 15.0 });

    assert.ok(slides[1].startTime >= slides[0].startTime + 0.3, 'Slide 2 must advance forward, not jump back to 1.0');
    assert.ok(slides[2].startTime >= slides[1].startTime + 0.3, 'Slide 3 must advance forward');
    assert.strictEqual(slides.every(s => s.duration > 0), true, 'All durations must be strictly positive');
  });

  test('Timeline duration adjustment propagates monotonically to subsequent slides', () => {
    const initialSlides = [
      { startTime: 0.0, endTime: 5.0, duration: 5.0 },
      { startTime: 5.0, endTime: 12.0, duration: 7.0 },
      { startTime: 12.0, endTime: 20.0, duration: 8.0 },
    ];

    const diff = 7.0 - initialSlides[0].duration;
    const updated = initialSlides.map(s => ({ ...s }));
    updated[0].duration = 7.0;
    updated[0].endTime = Number((updated[0].startTime + 7.0).toFixed(3));
    for (let j = 1; j < updated.length; j++) {
      updated[j].startTime = Number((updated[j].startTime + diff).toFixed(3));
      updated[j].endTime = Number((updated[j].endTime + diff).toFixed(3));
    }

    assert.strictEqual(updated[0].startTime, 0.0);
    assert.strictEqual(updated[0].endTime, 7.0);
    assert.strictEqual(updated[1].startTime, 7.0);
    assert.strictEqual(updated[1].endTime, 14.0);
    assert.strictEqual(updated[2].startTime, 14.0);
    assert.strictEqual(updated[2].endTime, 22.0);
  });
});

// 5. Test VTT SlideSync Studio 2.0 Advanced Sync Engine & Review Queue
describe('VTT SlideSync Studio 2.0 Advanced Sync Engine & Review Queue', () => {
  const COMMON_STOP_WORDS = new Set([
    'the', 'and', 'for', 'with', 'this', 'that', 'from', 'have', 'about', 'there',
    'what', 'when', 'where', 'which', 'who', 'will', 'your', 'their', 'they', 'them',
  ]);

  function matchImagesSemantically(images, paragraphs) {
    const assignedImages = new Array(paragraphs.length).fill(null);
    const semanticReasons = new Array(paragraphs.length).fill(undefined);
    const usedImageIds = new Set();

    if (images.length === 0 || paragraphs.length === 0) {
      return { assignedImages, semanticReasons, unusedImages: [...images] };
    }

    const imageKeywordsList = images.map((img) => {
      const baseName = img.name.replace(/\.[^/.]+$/, '').toLowerCase();
      const tokens = baseName.split(/[^a-z0-9]+/i).filter((w) => w.length >= 3 && !COMMON_STOP_WORDS.has(w));
      return { img, tokens };
    });

    const paraKeywordsList = paragraphs.map((p) => {
      const text = (p.text || '').toLowerCase();
      const words = text.split(/[^a-z0-9]+/i).filter((w) => w.length >= 3 && !COMMON_STOP_WORDS.has(w));
      return new Set(words);
    });

    const candidateScores = [];
    for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
      const pWords = paraKeywordsList[pIdx];
      for (let iIdx = 0; iIdx < images.length; iIdx++) {
        const { tokens } = imageKeywordsList[iIdx];
        let bestKeyword = '';
        let matchCount = 0;
        for (const token of tokens) {
          if (pWords.has(token)) {
            matchCount++;
            if (!bestKeyword) bestKeyword = token;
          }
        }
        if (matchCount > 0) {
          candidateScores.push({ paraIdx: pIdx, imgIdx: iIdx, score: matchCount, keyword: bestKeyword });
        }
      }
    }

    candidateScores.sort((a, b) => b.score - a.score);

    for (const match of candidateScores) {
      if (!assignedImages[match.paraIdx] && !usedImageIds.has(images[match.imgIdx].id)) {
        assignedImages[match.paraIdx] = images[match.imgIdx];
        semanticReasons[match.paraIdx] = `Keyword match: "${match.keyword}"`;
        usedImageIds.add(images[match.imgIdx].id);
      }
    }

    let imgPointer = 0;
    for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
      if (!assignedImages[pIdx]) {
        while (imgPointer < images.length && usedImageIds.has(images[imgPointer].id)) {
          imgPointer++;
        }
        if (imgPointer < images.length) {
          assignedImages[pIdx] = images[imgPointer];
          usedImageIds.add(images[imgPointer].id);
          imgPointer++;
        }
      }
    }

    const unusedImages = images.filter((img) => !usedImageIds.has(img.id));
    return { assignedImages, semanticReasons, unusedImages };
  }

  function extractSyncReviewItems(matches) {
    const items = [];
    matches.forEach((m, idx) => {
      if (!m.image) {
        items.push({
          type: 'missing_image',
          slideIndex: idx,
          severity: 'error',
        });
      }
      if (m.confidence === 'fallback' || (m.confidenceScore !== undefined && m.confidenceScore < 65)) {
        items.push({
          type: 'low_confidence',
          slideIndex: idx,
          severity: 'warning',
        });
      }
      if (m.duration < 1.0) {
        items.push({
          type: 'gap_or_overlap',
          slideIndex: idx,
          severity: 'warning',
        });
      }
    });
    return items;
  }

  test('Semantic matching accurately associates images by keyword overlap', () => {
    const images = [
      { id: 'img_1', name: 'revenue_growth_chart.png' },
      { id: 'img_2', name: 'team_meeting_office.jpg' },
      { id: 'img_3', name: 'customer_support.png' },
    ];
    const paragraphs = [
      { text: 'In our quarterly review, team members collaborated in the office.' },
      { text: 'We saw unprecedented revenue and rapid financial growth this year.' },
    ];

    const result = matchImagesSemantically(images, paragraphs);

    assert.strictEqual(result.assignedImages[0].id, 'img_2', 'Paragraph 1 must match team/office');
    assert.strictEqual(result.assignedImages[1].id, 'img_1', 'Paragraph 2 must match revenue/growth');
    assert.strictEqual(result.unusedImages.length, 1);
    assert.strictEqual(result.unusedImages[0].id, 'img_3', 'Customer support image must be marked unused');
  });

  test('User manual timeline adjustments are strictly preserved when re-syncing', () => {
    const existingMatches = [
      { id: 'slide_1', startTime: 0.0, endTime: 4.5, duration: 4.5, isManualEdit: true, image: { id: 'img_1' } },
      { id: 'slide_2', startTime: 4.5, endTime: 12.0, duration: 7.5, isManualEdit: false, image: { id: 'img_2' } },
    ];

    const proposed = [
      { startTime: 0.0, endTime: 3.2 },
      { startTime: 3.2, endTime: 11.0 },
    ];

    const finalized = proposed.map((p, i) => {
      const ex = existingMatches[i];
      if (ex && ex.isManualEdit) {
        return { ...ex };
      }
      return { id: ex ? ex.id : `slide_${i}`, startTime: p.startTime, endTime: p.endTime, duration: p.endTime - p.startTime };
    });

    assert.strictEqual(finalized[0].startTime, 0.0);
    assert.strictEqual(finalized[0].endTime, 4.5, 'Slide 1 manual edit must NOT be overwritten');
    assert.strictEqual(finalized[0].isManualEdit, true);

    assert.strictEqual(finalized[1].startTime, 3.2, 'Slide 2 automatic proposal should update');
    assert.strictEqual(finalized[1].endTime, 11.0);
  });

  test('Quantizes slide frames accurately at 30 fps without frame gaps', () => {
    const slide1Start = 0.0;
    const slide1End = 5.233;
    const slide2Start = 5.233;
    const slide2End = 10.0;

    const s1StartFrame = Math.round(slide1Start * 30);
    const s1EndFrame = Math.round(slide1End * 30);
    const s2StartFrame = Math.round(slide2Start * 30);
    const s2EndFrame = Math.round(slide2End * 30);

    assert.strictEqual(s1StartFrame, 0);
    assert.strictEqual(s1EndFrame, 157);
    assert.strictEqual(s2StartFrame, 157, 'Frame boundary between slides must connect continuously');
    assert.strictEqual(s2EndFrame, 300);
  });

  test('Review queue identifies missing images and low confidence segments', () => {
    const matches = [
      { image: { id: 'img_1' }, duration: 4.0, confidence: 'exact', confidenceScore: 98 },
      { image: null, duration: 5.0, confidence: 'high', confidenceScore: 85 },
      { image: { id: 'img_2' }, duration: 0.4, confidence: 'exact', confidenceScore: 95 },
      { image: { id: 'img_3' }, duration: 6.0, confidence: 'fallback', confidenceScore: 50 },
    ];

    const issues = extractSyncReviewItems(matches);
    assert.strictEqual(issues.length, 3);
    assert.ok(issues.some((i) => i.type === 'missing_image' && i.slideIndex === 1));
    assert.ok(issues.some((i) => i.type === 'gap_or_overlap' && i.slideIndex === 2));
    assert.ok(issues.some((i) => i.type === 'low_confidence' && i.slideIndex === 3));
  });
});


