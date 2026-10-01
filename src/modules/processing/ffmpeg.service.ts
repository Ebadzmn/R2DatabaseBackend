import { spawn, execSync } from "child_process";
import path from "path";
import fs from "fs/promises";
import os from "os";
import { env } from "../../config/env";
import { logger } from "../../utils/logger";
import { MediaProbeResult } from "../../services/media-metadata.service";

let resolvedFfmpegPath = "ffmpeg";

try {
  if (env.FFMPEG_PATH) {
    resolvedFfmpegPath = env.FFMPEG_PATH;
  } else {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
    if (ffmpegInstaller?.path) {
      resolvedFfmpegPath = ffmpegInstaller.path;
    }
  }
} catch (e) {
  logger.warn({ err: e }, "Could not set automatic ffmpeg path, relying on system PATH");
}

/**
 * Universal Hardware/CPU Encoder Auto-Detection:
 * Works across Linux, Windows, and macOS (Supports NVENC, QSV, VAAPI, VideoToolbox, and CPU libx264)
 */
export interface EncoderCapabilities {
  codec: string;
  presetArgs: string[];
  isHardware: boolean;
  name: string;
}

let cachedEncoder: EncoderCapabilities | null = null;

function detectBestEncoder(): EncoderCapabilities {
  if (cachedEncoder) return cachedEncoder;

  try {
    const stdout = execSync(`"${resolvedFfmpegPath}" -encoders 2>/dev/null`, { encoding: "utf8" });

    // 1. NVIDIA GPU (Linux / Windows VPS) - Fastest on servers with NVIDIA GPUs
    if (stdout.includes("h264_nvenc")) {
      cachedEncoder = {
        codec: "h264_nvenc",
        presetArgs: ["-preset", "p1", "-tune", "ll"], // p1 (fastest NVENC)
        isHardware: true,
        name: "NVIDIA NVENC (GPU)",
      };
      logger.info({ encoder: cachedEncoder.name }, "Hardware encoder detected: NVIDIA NVENC");
      return cachedEncoder;
    }

    // 2. Intel QuickSync (Linux / Windows / Intel CPUs)
    if (stdout.includes("h264_qsv")) {
      cachedEncoder = {
        codec: "h264_qsv",
        presetArgs: ["-preset", "veryfast"],
        isHardware: true,
        name: "Intel QuickSync (QSV)",
      };
      logger.info({ encoder: cachedEncoder.name }, "Hardware encoder detected: Intel QuickSync");
      return cachedEncoder;
    }

    // 3. Apple Silicon (macOS)
    if (process.platform === "darwin" && stdout.includes("h264_videotoolbox")) {
      cachedEncoder = {
        codec: "h264_videotoolbox",
        presetArgs: ["-realtime", "1"],
        isHardware: true,
        name: "Apple Silicon VideoToolbox",
      };
      logger.info({ encoder: cachedEncoder.name }, "Hardware encoder detected: Apple VideoToolbox");
      return cachedEncoder;
    }

    // 4. Linux VA-API (Generic Linux AMD/Intel Hardware Acceleration)
    if (process.platform === "linux" && stdout.includes("h264_vaapi")) {
      cachedEncoder = {
        codec: "h264_vaapi",
        presetArgs: [],
        isHardware: true,
        name: "Linux VA-API",
      };
      logger.info({ encoder: cachedEncoder.name }, "Hardware encoder detected: Linux VA-API");
      return cachedEncoder;
    }
  } catch (err: any) {
    logger.warn({ err: err?.message }, "Failed to auto-detect hardware encoders, using optimized CPU fallback");
  }

  // 5. Universal CPU Fallback (Optimized for low-end Linux & Windows servers)
  cachedEncoder = {
    codec: "libx264",
    presetArgs: ["-preset", "ultrafast", "-tune", "fastdecode"],
    isHardware: false,
    name: "Universal libx264 (CPU Ultra-Fast)",
  };
  logger.info({ encoder: cachedEncoder.name }, "Using high-performance universal CPU encoder");
  return cachedEncoder;
}

export interface RenditionConfig {
  name: string; // "1080p", "720p"
  resolution: string; // "1920x1080", "1280x720"
  width: number;
  height: number;
  videoBitrate: string; // "3000k", "1800k"
  maxBitrate: string;
  bufSize: string;
  audioBitrate: string; // "128k"
  bandwidth: number; // in bps
}

export const RENDITIONS: RenditionConfig[] = [
  {
    name: "1080p",
    resolution: "1920x1080",
    width: 1920,
    height: 1080,
    videoBitrate: "3000k",
    maxBitrate: "3500k",
    bufSize: "6000k",
    audioBitrate: "128k",
    bandwidth: 3500000,
  },
  {
    name: "720p",
    resolution: "1280x720",
    width: 1280,
    height: 720,
    videoBitrate: "1800k",
    maxBitrate: "2200k",
    bufSize: "3600k",
    audioBitrate: "128k",
    bandwidth: 2200000,
  },
];

export class FFmpegService {
  /**
   * Always generates both 1080p and 720p if source >= 1080p, or 720p if source is 720p.
   */
  public static selectRenditions(probe: MediaProbeResult): RenditionConfig[] {
    const height = probe.height || 720;
    if (height >= 1080) {
      return RENDITIONS; // Both 1080p & 720p
    } else {
      return [RENDITIONS[1]]; // 720p only
    }
  }

  /**
   * Cross-Platform Fast HLS Transcoder (Linux, Windows, macOS)
   * Automatically leverages GPU (NVIDIA NVENC, Intel QSV, Apple VideoToolbox) or lightweight CPU libx264.
   */
  public static async generateRenditionsHLS(
    inputPath: string,
    outputDir: string,
    renditions: RenditionConfig[],
    totalDurationSeconds = 0,
    onProgress?: (percent: number) => void
  ): Promise<void> {
    const encoder = detectBestEncoder();

    // Ensure rendition directories exist
    for (const r of renditions) {
      await fs.mkdir(path.join(outputDir, r.name), { recursive: true });
    }

    // Adaptive CPU Thread Allocation for Linux/Windows/Mac
    const totalCpus = os.cpus()?.length || 2;
    // On low-end 2-core / 4-core servers, leave 1 thread free for OS/API
    const safeThreads = encoder.isHardware ? 2 : Math.max(1, Math.min(4, totalCpus - 1));

    let completedRenditions = 0;

    for (const rendition of renditions) {
      const renditionDir = path.join(outputDir, rendition.name);
      const args: string[] = [
        "-y",
        "-i", inputPath,
        "-threads", String(safeThreads),
        "-c:v", encoder.codec,
        ...encoder.presetArgs,
        "-vf", `scale=-2:${rendition.height}`,
        "-b:v", rendition.videoBitrate,
        "-maxrate", rendition.maxBitrate,
        "-bufsize", rendition.bufSize,
        "-c:a", "aac",
        "-b:a", rendition.audioBitrate,
        "-ar", "44100",
        "-ac", "2",
        "-g", "60",
        "-keyint_min", "60",
        "-sc_threshold", "0",
        "-hls_time", "6",
        "-hls_list_size", "0",
        "-hls_segment_type", "mpegts",
        "-hls_segment_filename", path.join(renditionDir, "segment_%03d.ts"),
        path.join(renditionDir, "index.m3u8"),
      ];

      await new Promise<void>((resolve, reject) => {
        logger.info(
          {
            rendition: rendition.name,
            encoder: encoder.name,
            safeThreads,
            platform: process.platform,
          },
          "Generating cross-platform HLS rendition stream"
        );

        const proc = spawn(resolvedFfmpegPath, args, {
          cwd: renditionDir,
          windowsHide: true,
        });

        let stderrOutput = "";
        let lastParsedPercent = 0;

        proc.stderr.on("data", (data) => {
          const str = data.toString();
          stderrOutput += str;

          if (onProgress && totalDurationSeconds > 0) {
            const timeMatch = str.match(/time=(\d+):(\d+):(\d+\.?\d*)/);
            if (timeMatch) {
              const hours = parseInt(timeMatch[1], 10);
              const minutes = parseInt(timeMatch[2], 10);
              const seconds = parseFloat(timeMatch[3]);
              const currentSeconds = hours * 3600 + minutes * 60 + seconds;
              const rawPercent = Math.min(99, Math.round((currentSeconds / totalDurationSeconds) * 100));

              if (rawPercent > lastParsedPercent) {
                lastParsedPercent = rawPercent;
                const overallPercent = Math.round(
                  ((completedRenditions + rawPercent / 100) / renditions.length) * 100
                );
                onProgress(overallPercent);
              }
            }
          }
        });

        proc.on("error", (err) => {
          logger.error({ err, rendition: rendition.name }, "FFmpeg process failed to spawn");
          reject(err);
        });

        proc.on("close", (code) => {
          if (code === 0) {
            logger.info({ rendition: rendition.name }, "Rendition generated successfully");
            completedRenditions++;
            resolve();
          } else {
            logger.error({ code, stderr: stderrOutput.slice(-1000) }, "FFmpeg rendition process failed");
            reject(new Error(`FFmpeg exited with code ${code}: ${stderrOutput.slice(-500)}`));
          }
        });
      });
    }
  }

  /**
   * Generates master.m3u8 playlist combining all generated renditions
   */
  public static async generateMasterPlaylist(
    outputDir: string,
    renditions: RenditionConfig[]
  ): Promise<string> {
    const masterPath = path.join(outputDir, "master.m3u8");
    let content = "#EXTM3U\n#EXT-X-VERSION:3\n\n";

    for (const rendition of renditions) {
      content += `#EXT-X-STREAM-INF:BANDWIDTH=${rendition.bandwidth},RESOLUTION=${rendition.resolution},NAME="${rendition.name}"\n`;
      content += `${rendition.name}/index.m3u8\n\n`;
    }

    await fs.writeFile(masterPath, content, "utf8");
    logger.info(
      { masterPath, renditions: renditions.map((r) => r.name) },
      "Master HLS playlist written successfully"
    );
    return masterPath;
  }
}
