'use client';

export type BeatAnalysis = {
  bpm: number;
  beats: number[]; // timestamps in seconds
};

// ─── Shared helpers ───────────────────────────────────────────────────────────

async function renderBand(
  decoded: AudioBuffer,
  loHz: number,
  hiHz: number,
): Promise<Float32Array> {
  const sr     = decoded.sampleRate;
  const offCtx = new OfflineAudioContext(1, decoded.length, sr);
  const src    = offCtx.createBufferSource();
  src.buffer   = decoded;

  const hp = offCtx.createBiquadFilter();
  hp.type            = "highpass";
  hp.frequency.value = loHz;
  hp.Q.value         = 0.5;

  const lp = offCtx.createBiquadFilter();
  lp.type            = "lowpass";
  lp.frequency.value = hiHz;
  lp.Q.value         = 0.5;

  src.connect(hp); hp.connect(lp); lp.connect(offCtx.destination);
  src.start(0);

  const buf = await offCtx.startRendering();
  return buf.getChannelData(0);
}

function frameRms(data: Float32Array, hopLen: number): Float32Array {
  const n   = Math.floor(data.length / hopLen);
  const rms = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const off = i * hopLen;
    let s = 0;
    for (let j = 0; j < hopLen; j++) s += data[off + j] ** 2;
    rms[i] = Math.sqrt(s / hopLen);
  }
  return rms;
}

function positiveFlux(rms: Float32Array): Float32Array {
  const flux = new Float32Array(rms.length);
  for (let i = 1; i < rms.length; i++) flux[i] = Math.max(0, rms[i] - rms[i - 1]);
  return flux;
}

function smoothArray(arr: Float32Array, halfWin: number): Float32Array {
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    const lo = Math.max(0, i - halfWin);
    const hi = Math.min(arr.length - 1, i + halfWin);
    let s = 0, c = 0;
    for (let j = lo; j <= hi; j++) { s += arr[j]; c++; }
    out[i] = s / c;
  }
  return out;
}

// ─── Beat detection ────────────────────────────────────────────────────────────
//
// Improvements over the previous version:
// 1. Low-band filter (20-250 Hz): focuses on kick/bass — primary beat source,
//    much cleaner onset signal than full-band energy.
// 2. Normalized onset function: robust to loudness differences.
// 3. Adaptive beat snapping: for each grid position snap to the nearest real
//    onset peak within ±18% of the beat period.  Handles human tempo drift.

export async function analyzeBeat(
  audioUrl: string,
  onProgress?: (pct: number) => void,
): Promise<BeatAnalysis> {
  const resp = await fetch(audioUrl);
  const buf  = await resp.arrayBuffer();
  onProgress?.(10);

  const ctx     = new AudioContext();
  const decoded = await ctx.decodeAudioData(buf);
  await ctx.close();
  onProgress?.(25);

  const sr       = decoded.sampleRate;
  const duration = decoded.length / sr;

  // 1. Low-band render (20-250 Hz): kick + bass = primary rhythm signal
  const lowData = await renderBand(decoded, 20, 250);
  onProgress?.(45);

  // 2. Frame energy at 10 ms resolution
  const FPS      = 100;
  const frameLen = Math.round(sr / FPS);
  const nFrames  = Math.floor(lowData.length / frameLen);
  const energy   = new Float32Array(nFrames);

  for (let i = 0; i < nFrames; i++) {
    const off = i * frameLen;
    let s = 0;
    for (let j = 0; j < frameLen; j++) s += lowData[off + j] ** 2;
    energy[i] = s / frameLen;
  }

  // 3. Onset strength = positive first derivative, then normalize to [0,1]
  const onset = new Float32Array(nFrames);
  for (let i = 1; i < nFrames; i++) onset[i] = Math.max(0, energy[i] - energy[i - 1]);
  const maxOnset = Math.max(...onset) || 1;
  for (let i = 0; i < nFrames; i++) onset[i] /= maxOnset;

  // 4. Autocorrelation on onset envelope to find dominant BPM
  const minP   = Math.round(FPS * 60 / 185);
  const maxP   = Math.round(FPS * 60 / 55);
  const corrN  = Math.min(nFrames, FPS * 90); // analyse up to 90 s
  let bestCorr = -1, bestPeriod = Math.round(FPS * 60 / 120);

  for (let lag = minP; lag <= maxP; lag++) {
    let c = 0;
    for (let i = 0; i < corrN - lag; i++) c += onset[i] * onset[i + lag];
    if (c > bestCorr) { bestCorr = c; bestPeriod = lag; }
  }
  onProgress?.(65);

  // Half-time / double-time correction
  const rawBpm = FPS * 60 / bestPeriod;
  let bpm = Math.round(rawBpm);
  if (bpm > 160) bpm = Math.round(bpm / 2);
  if (bpm < 60)  bpm = Math.round(bpm * 2);
  bpm = Math.max(60, Math.min(200, bpm));

  const beatPeriodSec = 60 / bpm;
  const actualPeriod  = Math.round(FPS * beatPeriodSec);

  // 5. Phase estimation: offset that maximises onset sum on the beat grid
  let bestPhase = 0, bestPhaseScore = -1;
  for (let p = 0; p < actualPeriod; p++) {
    let score = 0;
    for (let i = p; i < corrN; i += actualPeriod) score += onset[i];
    if (score > bestPhaseScore) { bestPhaseScore = score; bestPhase = p; }
  }

  // 6. Collect all real onset peaks for snapping
  // A peak is a local maximum above 12% of normalised max
  const PEAK_THRESH = 0.12;
  const peaks: number[] = []; // seconds, sorted
  for (let i = 1; i < nFrames - 1; i++) {
    if (onset[i] >= PEAK_THRESH && onset[i] >= onset[i - 1] && onset[i] >= onset[i + 1]) {
      peaks.push(i / FPS);
    }
  }

  // 7. Adaptive beat grid: snap each expected beat position to the nearest
  //    real onset peak within ±18% of the beat period.
  const snapTol   = beatPeriodSec * 0.18;
  const firstBeat = bestPhase / FPS;
  const beats: number[] = [];
  let peakSearchStart = 0;

  for (let t = firstBeat; t < duration; t += beatPeriodSec) {
    let bestSnap = t, bestDist = snapTol + 1;
    // Only search peaks near the expected position (peaks are sorted)
    for (let pi = peakSearchStart; pi < peaks.length; pi++) {
      const dist = Math.abs(peaks[pi] - t);
      if (peaks[pi] < t - snapTol) { peakSearchStart = pi; continue; }
      if (peaks[pi] > t + snapTol) break;
      if (dist < bestDist) { bestDist = dist; bestSnap = peaks[pi]; }
    }
    const pos = bestDist <= snapTol ? bestSnap : t;
    if (pos >= 0) beats.push(Number(pos.toFixed(3)));
  }

  onProgress?.(100);
  return { bpm, beats };
}

// ─── Musical structure analysis (Rock mode) ──────────────────────────────────
//
// Detects entry points of guitars, solos, riffs, and melodic phrases.
//
// Key improvements over previous version:
// 1. Two frequency bands instead of one:
//    - Mid (300-4 kHz): guitar body, chord changes, vocal melodies
//    - Presence (4-10 kHz): guitar solos, string attack, harmonic brightness
//      — this band lights up strongly when a solo or riff enters.
// 2. Weighted combined novelty (presence weighted 60% — solos are brighter).
// 3. Adaptive local threshold: sliding 30-second window median × 2.2
//    instead of a global mean. Adapts to the dynamic range of each section.
// 4. Minimum gap of 3 s between events (guitar sections are rarely shorter).
// 5. Score-based pruning keeps the most musically significant events.

export async function analyzeMusicalEvents(
  audioUrl: string,
  onProgress?: (pct: number) => void,
): Promise<number[]> {
  const resp = await fetch(audioUrl);
  const buf  = await resp.arrayBuffer();
  onProgress?.(10);

  const ctx     = new AudioContext();
  const decoded = await ctx.decodeAudioData(buf);
  await ctx.close();
  onProgress?.(20);

  const sr       = decoded.sampleRate;
  const duration = decoded.length / sr;

  // 1. Sequential band renders (sequential avoids browser issues with shared
  //    AudioBuffer being read by two OfflineAudioContexts simultaneously)
  const midData      = await renderBand(decoded, 300,  4000);
  onProgress?.(40);
  const presenceData = await renderBand(decoded, 4000, 10000);
  onProgress?.(58);

  // 2. RMS per 200 ms hop
  const HOP_SEC = 0.2;
  const hopLen  = Math.round(sr * HOP_SEC);

  const rmsMid      = frameRms(midData,      hopLen);
  const rmsPresence = frameRms(presenceData, hopLen);
  const nHops       = rmsMid.length;

  // 3. Positive flux per band
  const fluxMid      = positiveFlux(rmsMid);
  const fluxPresence = positiveFlux(rmsPresence);

  // 4. Weighted combined novelty (presence 60%: guitar solos are bright)
  const novelty = new Float32Array(nHops);
  for (let i = 0; i < nHops; i++) {
    novelty[i] = 0.4 * fluxMid[i] + 0.6 * fluxPresence[i];
  }

  // 5. Smooth over 1.5 s
  const smoothed = smoothArray(novelty, Math.round(1.5 / HOP_SEC));
  onProgress?.(72);

  // 6. Adaptive local threshold (±15 s sliding window)
  function pickEvents(multiplier: number): number[] {
    const WIN = Math.round(15.0 / HOP_SEC);
    const thr = new Float32Array(nHops);
    for (let i = 0; i < nHops; i++) {
      const lo = Math.max(0, i - WIN), hi = Math.min(nHops - 1, i + WIN);
      let s = 0, c = 0;
      for (let j = lo; j <= hi; j++) { s += smoothed[j]; c++; }
      thr[i] = (s / c) * multiplier;
    }

    const MIN_GAP = Math.round(3.0 / HOP_SEC);
    const cands: { hop: number; score: number }[] = [];
    let lastPeak = -MIN_GAP;

    for (let i = 1; i < nHops - 1; i++) {
      if (
        smoothed[i] > thr[i] &&
        smoothed[i] >= smoothed[i - 1] &&
        smoothed[i] >= smoothed[i + 1] &&
        i - lastPeak >= MIN_GAP
      ) {
        cands.push({ hop: i, score: smoothed[i] / (thr[i] || 1) });
        lastPeak = i;
      }
    }

    const maxEvt = Math.max(3, Math.floor(duration / 8));
    const pruned = cands.length > maxEvt
      ? cands.sort((a, b) => b.score - a.score).slice(0, maxEvt).sort((a, b) => a.hop - b.hop)
      : cands;

    return pruned.map((c) => Number((c.hop * HOP_SEC).toFixed(2)));
  }

  // Try progressively lower thresholds until we get at least 2 events
  let events = pickEvents(2.0);
  if (events.length < 2) events = pickEvents(1.5);
  if (events.length < 2) events = pickEvents(1.1);

  // Final fallback: if still empty, divide audio into equal sections
  // so the user always sees something happen (musically-neutral spacing)
  if (events.length === 0 && duration > 20) {
    const nSec = Math.min(8, Math.max(3, Math.floor(duration / 15)));
    const step  = duration / (nSec + 1);
    events = Array.from({ length: nSec }, (_, i) => Number(((i + 1) * step).toFixed(2)));
  }

  onProgress?.(100);
  return events;
}
