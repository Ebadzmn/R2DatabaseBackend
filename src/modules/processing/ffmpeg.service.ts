import { spawn } from "child_process";
import path from "path";
import fs from "fs/promises";
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

export interface RenditionConfig {
  name: string; // e.g. "1080p", "720p"
  resolution: string; // "1920x1080"
  width: number;
  height: number;
  videoBitrate: string; // "4500k"
  audioBitrate: string; // "192k"
  bandwidth: number; // in bps
}

export const RENDITIONS: RenditionConfig[] = [
  {
    name: "1080p",
    resolution: "1920x1080",
    width: 1920,
    height: 1080,
    videoBitrate: "4500k",
    audioBitrate: "192k",
    bandwidth: 5000000,
  },
  {
    name: "720p",
    resolution: "1280x720",
    width: 1280,
    height: 720,
    videoBitrate: "2500k",
    audioBitrate: "128k",
    bandwidth: 2800000,
  },
];

export class FFmpegService {
  /**
   * Smartly checks if the video is already H.264/AAC at 720p or standard streaming format
   * which can be remuxed/packetized directly without CPU-intensive re-encoding.
   */
  public static canFastRemuxHLS(probe: MediaProbeResult): boolean {
    const isH264 = probe.videoCodec?.toLowerCase().includes("h264") || probe.videoCodec?.toLowerCase().includes("avc");
    const isAAC = !probe.audioCodec || probe.audioCodec.toLowerCase().includes("aac");
    const height = probe.height || 0;
    // If <= 720p and already in web standard h264/aac codec, fast remux takes 1-2 seconds!
    return Boolean(isH264 && isAAC && height > 0 && height <= 720);
  }

  /**
   * Ultra-fast Stream Copy (Remuxing) directly to HLS segments without re-encoding
   * Speed: 50x - 100x realtime (Instant 2-3 seconds for a 4 min video!)
   */
  public static async generateFastDirectHLS(
    inputPath: string,
    outputDir: string,
    onProgress?: (percent: number) => void
  ): Promise<void> {
    const renditionDir = path.join(outputDir, "720p");
    await fs.mkdir(renditionDir, { recursive: true });

    // Stream copy (-c copy): zero quality loss, zero CPU lag, instant HLS packetizing
    const args = [
      "-y",
      "-i",
      inputPath,
      "-c:v",
      "copy",
      "-c:a",
      "copy",
      "-hls_time",
      "6",
      "-hls_list_size",
      "0",
      "-hls_segment_type",
      "mpegts",
      "-hls_segment_filename",
      "segment_%03d.ts",
      "index.m3u8",
    ];

    return new Promise((resolve, reject) => {
      logger.info({ cwd: renditionDir }, "Executing ultra-fast HLS stream remuxing (direct copy)");

      const proc = spawn(resolvedFfmpegPath, args, {
        cwd: renditionDir,
        windowsHide: true,
      });

      let stderrOutput = "";

      proc.stderr.on("data", (data) => {
        stderrOutput += data.toString();
        if (onProgress) onProgress(60);
      });

      proc.on("error", (err) => {
        logger.error({ err }, "Failed to execute fast HLS stream remuxing");
        reject(err);
      });

      proc.on("close", (code) => {
        if (code === 0) {
          logger.info("Fast HLS stream remuxing completed successfully");
          if (onProgress) onProgress(100);
          resolve();
        } else {
          logger.warn({ code, stderr: stderrOutput.slice(-500) }, "Fast remuxing failed, falling back to standard encode");
          reject(new Error(`Fast remux exited with code ${code}`));
        }
      });
    });
  }

  /**
   * Determines target renditions based on the source video resolution
   */
  public static selectRenditions(probe: MediaProbeResult): RenditionConfig[] {
    const height = probe.height || 720;

    if (height >= 1080) {
      return RENDITIONS; // 1080p, 720p
    } else {
      return RENDITIONS.filter((r) => r.name === "720p"); // 720p only
    }
  }

  /**
   * High-Performance Multi-threaded HLS Transcoder
   */
  public static async generateRendition(
    inputPath: string,
    outputDir: string,
    rendition: RenditionConfig,
    totalDurationSeconds = 0,
    onProgress?: (percent: number) => void
  ): Promise<void> {
    const renditionDir = path.join(outputDir, rendition.name);
    await fs.mkdir(renditionDir, { recursive: true });

    const args = [
      "-y",
      "-i",
      inputPath,
      "-c:v",
      "libx264",
      "-s",
      `${rendition.width}x${rendition.height}`,
      "-b:v",
      rendition.videoBitrate,
      "-c:a",
      "aac",
      "-b:a",
      rendition.audioBitrate,
      "-preset",
      "ultrafast", // Highest possible transcoding speed
      "-tune",
      "fastdecode",
      "-threads",
      "0", // Leverage all available CPU cores
      "-g",
      "48",
      "-sc_threshold",
      "0",
      "-hls_time",
      "6",
      "-hls_list_size",
      "0",
      "-hls_segment_type",
      "mpegts",
      "-hls_segment_filename",
      "segment_%03d.ts",
      "index.m3u8",
    ];

    return new Promise((resolve, reject) => {
      logger.info({ rendition: rendition.name, cwd: renditionDir }, "Starting high-speed FFmpeg rendition spawn");

      const proc = spawn(resolvedFfmpegPath, args, {
        cwd: renditionDir,
        windowsHide: true,
      });

      let stderrOutput = "";
      let lastParsedPercent = 0;

      proc.stderr.on("data", (data) => {
        const str = data.toString();
        stderrOutput += str;

        // Accurate FFmpeg progress parsing from stderr: time=00:01:23.45
        if (onProgress && totalDurationSeconds > 0) {
          const timeMatch = str.match(/time=(\d+):(\d+):(\d+\.?\d*)/);
          if (timeMatch) {
            const hours = parseInt(timeMatch[1], 10);
            const minutes = parseInt(timeMatch[2], 10);
            const seconds = parseFloat(timeMatch[3]);
            const currentSeconds = hours * 3600 + minutes * 60 + seconds;
            const percent = Math.min(99, Math.round((currentSeconds / totalDurationSeconds) * 100));

            if (percent > lastParsedPercent) {
              lastParsedPercent = percent;
              onProgress(percent);
            }
          }
        }
      });

      proc.on("error", (err) => {
        logger.error({ err, rendition: rendition.name }, "Failed to spawn FFmpeg process");
        reject(err);
      });

      proc.on("close", (code) => {
        if (code === 0) {
          logger.info({ rendition: rendition.name }, "Rendition generated successfully");
          if (onProgress) onProgress(100);
          resolve();
        } else {
          logger.error({ code, stderr: stderrOutput.slice(-1000) }, "FFmpeg process failed");
          reject(new Error(`FFmpeg exited with code ${code}: ${stderrOutput.slice(-500)}`));
        }
      });
    });
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
    logger.info({ masterPath }, "Master HLS playlist written successfully");
    return masterPath;
  }
}
