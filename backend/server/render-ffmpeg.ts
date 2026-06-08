import Ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import { mkdir, rm, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import { exportPresets, summarizeComposition } from "../lib/media-rules";
import { AUDIO_BITRATE, CODEC_CRF, DEFAULT_OUTPUT_OPTIONS } from "../lib/types";
import type { CompositionSummary, ExportPreset, MediaItem, OutputOptions, RenderJob, RenderRequest, VisualSegment, Watermark, WatermarkPosition } from "../lib/types";
import { getJob, saveJob, saveJobOutputKey } from "./job-store";
import { downloadToFile, uploadBuffer, generateDownloadUrl } from "./r2-client";

if (ffmpegPath) {
  Ffmpeg.setFfmpegPath(ffmpegPath);
}

// ─── Ken Burns variants ───────────────────────────────────────────────────────
function kbVariantIndex(mediaId: string): number {
  let h = 0;
  for (const ch of mediaId) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  return Math.abs(h) % 4;
}

function kenBurnsFilter(mediaId: string, duration: number, w: number, h: number): string {
  const d  = Math.max(1, Math.ceil(duration * 30));
  const v  = kbVariantIndex(mediaId);
  const dz = (0.15 / d).toFixed(6);
  const pan = Math.round(w * 0.15 * 2 / d * 100) / 100;
  const exprs = [
    `z='min(zoom+${dz},1.3)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`,
    `z='1.1':x='iw/2-(iw/zoom/2)+in*${pan}':y='ih/2-(ih/zoom/2)'`,
    `z='if(lte(in,1),1.3,max(1.0,zoom-${dz}))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`,
    `z='1.1':x='iw/2-(iw/zoom/2)+(${Math.round(w * 0.15 * 2)})-in*${pan}':y='ih/2-(ih/zoom/2)'`,
  ];
  return `zoompan=${exprs[v]}:d=${d}:s=${w}x${h}`;
}

// ─── Public entry point ────────────────────────────────────────────────────

export function createFfmpegRenderJob(input: RenderRequest, userId = "anonymous"): RenderJob {
  const jobId = crypto.randomUUID();
  const summary = summarizeComposition(input.media, input.visuals, input.audios, input.mediaOrder, [], input.bpm ?? 0);

  const baseJob: RenderJob = {
    jobId,
    stage: "preparando",
    progress: 5,
    message: "Preparando renderizacao com FFmpeg",
    startedAt: Date.now(),
    summary,
    mode: "ffmpeg",
  };

  saveJob(baseJob);
  void runJob(jobId, input, summary, userId);

  return baseJob;
}

// ─── Job runner ─────────────────────────────────────────────────────────────

async function runJob(jobId: string, input: RenderRequest, summary: CompositionSummary, userId = "anonymous") {
  const workDir = join(tmpdir(), "qlipo-render", jobId);
  await mkdir(workDir, { recursive: true });

  const update = (stage: RenderJob["stage"], progress: number, message: string, extra?: Partial<RenderJob>) => {
    const current = getJob(jobId);
    if (current) saveJob({ ...current, stage, progress, message, ...extra });
  };

  try {
    update("montando_video", 15, "Baixando arquivos do R2...");

    // Download each media file from R2 to local /tmp
    const localPaths: Record<string, string> = {};
    for (const m of input.media) {
      if (!m.r2Key) continue;
      const ext = m.name.split(".").pop() ?? "bin";
      const localPath = join(workDir, `${m.id}.${ext}`);
      await downloadToFile(m.r2Key, localPath);
      localPaths[m.id] = localPath;
    }

    // Download watermark files
    for (const wm of input.watermarks ?? []) {
      const mediaItem = input.media.find((m) => m.id === wm.mediaId);
      if (!mediaItem?.r2Key || localPaths[wm.mediaId]) continue;
      const ext = mediaItem.name.split(".").pop() ?? "png";
      const localPath = join(workDir, `wm-${wm.mediaId}.${ext}`);
      await downloadToFile(mediaItem.r2Key, localPath);
      localPaths[wm.mediaId] = localPath;
    }

    update("montando_video", 20, "Iniciando FFmpeg...");

    const outputPath = await renderVideo(
      input.media,
      localPaths,
      summary,
      input.preset,
      jobId,
      (pct) => update("montando_video", 20 + Math.round(pct * 0.72), `Renderizando... ${pct}%`),
      input.textOverlays,
      input.watermarks,
      input.outputOptions ?? DEFAULT_OUTPUT_OPTIONS,
    );

    update("muxando", 95, "Enviando video para armazenamento...");

    const ext = (input.outputOptions?.codec === "vp9") ? "webm" : "mp4";
    const r2Key = `renders/${userId}/${jobId}/output.${ext}`;
    const buffer = await readFile(outputPath);
    await uploadBuffer(r2Key, buffer, ext === "webm" ? "video/webm" : "video/mp4");

    saveJobOutputKey(jobId, r2Key);

    // Clean up local temp files
    await rm(workDir, { recursive: true, force: true });

    const downloadUrl = await generateDownloadUrl(r2Key, 86400);

    update("finalizado", 100, "Renderizacao concluida. Video disponivel para download.", {
      completedAt: Date.now(),
      downloadUrl,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Erro desconhecido no FFmpeg";
    console.error("[render-ffmpeg] job error:", msg);
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    update("erro", 100, msg, { completedAt: Date.now() });
  }
}

// ─── Gap detection ────────────────────────────────────────────────────────────

function detectGaps(segments: VisualSegment[]): boolean {
  if (segments.length === 0) return false;
  const sorted = [...segments].sort((a, b) => a.startAt - b.startAt);
  if (sorted[0].startAt > 0.05) return true;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startAt - sorted[i - 1].endAt > 0.05) return true;
  }
  return false;
}

// ─── Core FFmpeg renderer ─────────────────────────────────────────────────────

async function renderVideo(
  mediaItems: MediaItem[],
  localPaths: Record<string, string>,
  summary: CompositionSummary,
  preset: ExportPreset,
  jobId: string,
  onProgress?: (percent: number) => void,
  textOverlays?: import("../lib/types").TextOverlay[],
  watermarks?: Watermark[],
  outputOpts: OutputOptions = DEFAULT_OUTPUT_OPTIONS,
): Promise<string> {
  const outputDir = join(tmpdir(), "qlipo-render", jobId);
  const ext = outputOpts.codec === "vp9" ? "webm" : "mp4";
  const outputPath = join(outputDir, `output.${ext}`);

  const { width, height } = exportPresets[preset];

  await new Promise<void>((resolve, reject) => {
    const command = Ffmpeg();
    const filters: string[] = [];

    const sortedSegs = [...summary.visualSegments].sort((a, b) => a.startAt - b.startAt);
    const withGaps = detectGaps(sortedSegs);

    const videoLabels: string[] = [];
    let fileInputIdx = 0;
    let blackIdx = 0;

    const processClip = (seg: VisualSegment, applyFadeIn = true, applyFadeOut = true) => {
      const item = mediaItems.find((m) => m.id === seg.mediaId);
      const path = localPaths[seg.mediaId];
      if (!item || !path) return;

      const duration = Number((seg.endAt - seg.startAt).toFixed(3));
      const isImage  = item.kind === "image";
      const i        = fileInputIdx++;

      if (isImage) {
        command.input(path).inputOptions(["-loop", "1", "-t", String(duration + 0.5)]);
      } else {
        command.input(path);
      }

      let f = `[${i}:v]`;
      if (isImage) {
        const srcW = width * 2;
        const srcH = height * 2;
        f += `trim=duration=${duration},setpts=PTS-STARTPTS,`;
        f += `scale=${srcW}:${srcH}:force_original_aspect_ratio=increase,`;
        f += `crop=${srcW}:${srcH}:(iw-${srcW})/2:(ih-${srcH})/2,`;
        f += `${kenBurnsFilter(seg.mediaId, duration, width, height)},setsar=1`;
      } else {
        const speed = seg.speed ?? 1;
        const srcTrimEnd = Number((duration * speed).toFixed(3));
        const ptsScale  = speed !== 1 ? `setpts=PTS*${(1 / speed).toFixed(6)},` : "";
        f += `trim=end=${srcTrimEnd},setpts=PTS-STARTPTS,${ptsScale}`;
        f += `scale=${width}:${height}:force_original_aspect_ratio=decrease,`;
        f += `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30`;
      }

      if (applyFadeIn && seg.fadeInSeconds > 0) f += `,fade=t=in:st=0:d=${seg.fadeInSeconds}`;
      if (applyFadeOut && seg.fadeOutSeconds > 0) {
        const st = Math.max(0, duration - seg.fadeOutSeconds);
        if (st > 0) f += `,fade=t=out:st=${st.toFixed(3)}:d=${seg.fadeOutSeconds}`;
      }

      const brightness = seg.brightness ?? 1;
      const contrast   = seg.contrast   ?? 1;
      const saturation = seg.saturation ?? 1;
      const blur       = seg.blur       ?? 0;
      const opacity    = seg.opacity    ?? 1;

      if (brightness !== 1 || contrast !== 1) f += `,eq=brightness=${brightness - 1}:contrast=${contrast}`;
      if (saturation !== 1) f += `,hue=s=${saturation}`;
      if (blur > 0)         f += `,gblur=sigma=${blur}`;
      if (opacity < 1)      f += `,colorchannelmixer=aa=${opacity}`;

      const label = `[v${i}]`;
      f += label;
      filters.push(f);
      videoLabels.push(label);
    };

    if (withGaps) {
      let prevEnd = 0;
      for (const seg of sortedSegs) {
        const gap = Number((seg.startAt - prevEnd).toFixed(3));
        if (gap > 0.05) {
          const label = `[gap${blackIdx++}]`;
          filters.push(`color=color=black:size=${width}x${height}:rate=30:duration=${gap},setsar=1${label}`);
          videoLabels.push(label);
        }
        processClip(seg);
        prevEnd = seg.endAt;
      }
      if (videoLabels.length === 0) { reject(new Error("Nenhum segmento visual disponivel.")); return; }
      if (videoLabels.length === 1) {
        filters.push(`${videoLabels[0]}copy[vout]`);
      } else {
        filters.push(`${videoLabels.join("")}concat=n=${videoLabels.length}:v=1:a=0[vout]`);
      }
    } else {
      const hasXfade = sortedSegs.some((s) => s.transitionType && s.transitionType !== "fade");

      if (!hasXfade) {
        for (const seg of sortedSegs) processClip(seg);
        if (videoLabels.length === 0) { reject(new Error("Nenhum segmento visual disponivel.")); return; }
        if (videoLabels.length === 1) {
          filters.push(`${videoLabels[0]}copy[vout]`);
        } else {
          filters.push(`${videoLabels.join("")}concat=n=${videoLabels.length}:v=1:a=0[vout]`);
        }
      } else {
        const n = sortedSegs.length;
        for (let si = 0; si < n; si++) {
          processClip(sortedSegs[si], si === 0, si === n - 1);
        }
        if (videoLabels.length === 0) { reject(new Error("Nenhum segmento visual disponivel.")); return; }
        if (videoLabels.length === 1) {
          filters.push(`${videoLabels[0]}copy[vout]`);
        } else {
          let currentLabel = videoLabels[0];
          let cumulativeDur = Number((sortedSegs[0].endAt - sortedSegs[0].startAt).toFixed(3));
          let xfadeIdx = 0;

          for (let si = 1; si < n; si++) {
            const seg      = sortedSegs[si];
            const incoming = videoLabels[si];
            const xType    = (seg.transitionType && seg.transitionType !== "fade") ? seg.transitionType : "fade";
            const xDur     = Number(Math.max(0.1, seg.fadeInSeconds).toFixed(3));
            const offset   = Number(Math.max(0, cumulativeDur - xDur).toFixed(3));
            const outLabel = si === n - 1 ? "[vout]" : `[xf${xfadeIdx++}]`;

            filters.push(`${currentLabel}${incoming}xfade=transition=${xType}:duration=${xDur}:offset=${offset}${outLabel}`);
            currentLabel  = outLabel;
            cumulativeDur = Number((offset + (seg.endAt - seg.startAt)).toFixed(3));
          }
        }
      }
    }

    // ── Text overlays ───────────────────────────────────────────────────────
    if (textOverlays && textOverlays.length > 0) {
      const lastIdx = filters.length - 1;
      if (filters[lastIdx]?.endsWith("[vout]")) {
        filters[lastIdx] = filters[lastIdx].slice(0, -6) + "[vtbase]";
      }
      let prevLabel = "[vtbase]";
      textOverlays.forEach((ov, ti) => {
        const isLast   = ti === textOverlays.length - 1;
        const outLabel = isLast ? "[vout]" : `[vt${ti}]`;
        const hex      = ov.color.replace("#", "");
        const ffColor  = hex.length === 6 ? `0x${hex}` : "white";
        const x        = `(w*${(ov.x / 100).toFixed(4)})`;
        const y        = `(h*${(ov.y / 100).toFixed(4)})`;
        const safeText = ov.text.replace(/\\/g, "\\\\").replace(/'/g, "'").replace(/:/g, "\\:");
        const bold     = ov.fontWeight === "bold" ? ":Bold=1" : "";
        const fontdef  = `fontsize=${ov.fontSize}:fontcolor=${ffColor}${bold}:shadowcolor=black@0.5:shadowx=1:shadowy=1`;
        const fadeDur  = 0.4;
        const alphaExpr = ov.animation === "fade"
          ? `if(lt(t,${(ov.startAt + fadeDur).toFixed(3)}),(t-${ov.startAt.toFixed(3)})/${fadeDur},if(gt(t,${(ov.endAt - fadeDur).toFixed(3)}),(${ov.endAt.toFixed(3)}-t)/${fadeDur},1))`
          : "1";
        const enable = `between(t,${ov.startAt},${ov.endAt})`;
        filters.push(`${prevLabel}drawtext=text='${safeText}':x=${x}:y=${y}:${fontdef}:alpha='${alphaExpr}':enable='${enable}'${outLabel}`);
        prevLabel = outLabel;
      });
    }

    // ── Watermarks ──────────────────────────────────────────────────────────
    if (watermarks && watermarks.length > 0) {
      const lastIdx = filters.length - 1;
      if (filters[lastIdx]?.endsWith("[vout]")) {
        filters[lastIdx] = filters[lastIdx].slice(0, -6) + "[vw_base]";
      }
      let prevLabel = "[vw_base]";

      for (let wmIdx = 0; wmIdx < watermarks.length; wmIdx++) {
        const wm     = watermarks[wmIdx];
        const wmPath = localPaths[wm.mediaId];
        if (!wmPath) continue;

        const wmFileIdx     = fileInputIdx++;
        const wmWidthPercent = wm.size;
        const wmWidth       = Math.round((width * wmWidthPercent) / 100);

        command.input(wmPath).inputOptions(["-loop", "1", "-t", String(summary.totalVideoSeconds + 1)]);

        const positionMap: Record<WatermarkPosition, { x: number; y: number }> = {
          "top-left":     { x: 0, y: 0 },
          "top-right":    { x: width - wmWidth, y: 0 },
          "bottom-left":  { x: 0, y: height - Math.round((height * wmWidthPercent) / 100) },
          "bottom-right": { x: width - wmWidth, y: height - Math.round((height * wmWidthPercent) / 100) },
          "center":       { x: (width - wmWidth) / 2, y: (height - Math.round((height * wmWidthPercent) / 100)) / 2 },
        };
        const { x, y } = positionMap[wm.position];

        filters.push(`[${wmFileIdx}:v]scale=${wmWidth}:-1,format=rgba[wm${wmIdx}]`);

        const fadeInEnd    = Number((wm.startAt + wm.fadeInDuration).toFixed(3));
        const fadeOutStart = Number((wm.endAt - wm.fadeOutDuration).toFixed(3));
        const opacityExpr  = `if(lt(t,${fadeInEnd.toFixed(3)}),(t-${wm.startAt.toFixed(3)})/${wm.fadeInDuration.toFixed(3)},if(gt(t,${fadeOutStart.toFixed(3)}),(${wm.endAt.toFixed(3)}-t)/${wm.fadeOutDuration.toFixed(3)},1))`;
        const enable       = `between(t,${wm.startAt},${wm.endAt})`;
        const outLabel     = wmIdx === watermarks.length - 1 ? "[vout]" : `[vw${wmIdx}]`;

        filters.push(`${prevLabel}[wm${wmIdx}]overlay=x=${Math.round(x)}:y=${Math.round(y)}:enable='${enable}':alpha='${opacityExpr}'${outLabel}`);
        prevLabel = outLabel;
      }
    }

    // ── Audio ───────────────────────────────────────────────────────────────
    const audioLabels: string[] = [];
    for (let i = 0; i < summary.audioSegments.length; i++) {
      const seg  = summary.audioSegments[i];
      const path = localPaths[seg.mediaId];
      if (!path) continue;

      const audioIdx   = fileInputIdx + i;
      const segDuration = Number((seg.trimEnd - seg.trimStart).toFixed(3));
      const gain        = Math.pow(10, seg.gainDb / 20);

      command.input(path);

      let f = `[${audioIdx}:a]`;
      f += `atrim=start=${seg.trimStart}:end=${(seg.trimStart + segDuration).toFixed(3)},asetpts=PTS-STARTPTS`;
      f += `,volume=${gain.toFixed(6)}`;
      if (seg.fadeInSeconds > 0)  f += `,afade=t=in:st=0:d=${seg.fadeInSeconds}`;
      if (seg.fadeOutSeconds > 0) {
        const st = Math.max(0, segDuration - seg.fadeOutSeconds);
        if (st > 0) f += `,afade=t=out:st=${st.toFixed(3)}:d=${seg.fadeOutSeconds}`;
      }
      const delayMs = Math.round(seg.startAt * 1000);
      if (delayMs > 0) f += `,adelay=${delayMs}|${delayMs}`;
      f += `[a${i}]`;
      filters.push(f);
      audioLabels.push(`[a${i}]`);
    }

    // ── Output ──────────────────────────────────────────────────────────────
    const crf          = CODEC_CRF[outputOpts.codec][outputOpts.quality];
    const audioBitrate = AUDIO_BITRATE[outputOpts.audioQuality];
    const isVp9        = outputOpts.codec === "vp9";
    const isH265       = outputOpts.codec === "h265";

    const videoCodecArgs: string[] = isVp9
      ? ["-c:v", "libvpx-vp9", "-crf", String(crf), "-b:v", "0", "-row-mt", "1"]
      : isH265
        ? ["-c:v", "libx265", "-preset", "fast", "-crf", String(crf), "-tag:v", "hvc1"]
        : ["-c:v", "libx264", "-preset", "fast", "-crf", String(crf)];

    const outputOptions: string[] = [
      "-map", "[vout]",
      ...videoCodecArgs,
      "-r", String(outputOpts.fps),
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
    ];

    if (audioLabels.length > 0) {
      const sampleRate = isVp9 ? "48000" : "44100";
      if (audioLabels.length === 1) {
        filters.push(`${audioLabels[0]}aresample=${sampleRate}[aout]`);
      } else {
        filters.push(`${audioLabels.join("")}amix=inputs=${audioLabels.length}:duration=first:normalize=0,aresample=${sampleRate}[aout]`);
      }
      const audioCodec = isVp9 ? "libopus" : "aac";
      outputOptions.push("-map", "[aout]", "-c:a", audioCodec, "-b:a", `${audioBitrate}k`);
    }

    command
      .complexFilter(filters.join(";"))
      .outputOptions(outputOptions)
      .output(outputPath)
      .on("progress", (p) => {
        if (onProgress && typeof p.percent === "number") {
          onProgress(Math.min(99, Math.round(p.percent)));
        }
      })
      .on("end", () => resolve())
      .on("error", (err, _stdout, stderr) => {
        console.error("[FFmpeg] stderr:", stderr);
        reject(new Error(err.message));
      })
      .run();
  });

  return outputPath;
}
