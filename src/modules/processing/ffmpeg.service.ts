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
  name: string; // e.g. "1080p", "720p", "480p"
  resolution: string; // "1920x1080"
  width: number;
  height: number;
  videoBitrate: string; // "5000k"
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
  {
    name: "480p",
    resolution: "854x480",
    width: 854,
    height: 480,
    videoBitrate: "1200k",
    audioBitrate: "96k",
    bandwidth: 1400000,
  },
];

export class FFmpegService {
  /**
   * Determines target renditions based on the source video resolution
   */
  public static selectRenditions(probe: MediaProbeResult): RenditionConfig[] {
    const height = probe.height || 720;

    if (height >= 1080) {
      return RENDITIONS; // 1080p, 720p, 480p
    } else if (height >= 720) {
      return RENDITIONS.filter((r) => r.height <= 720); // 720p, 480p
    } else {
      return RENDITIONS.filter((r) => r.height <= 480); // 480p
    }
  }

  /**
   * Encodes a single HLS rendition using clean child_process.spawn
   * (Immune to Windows shell quoting, colon, and space splitting bugs)
   */
  public static async generateRendition(
    inputPath: string,
    outputDir: string,
    rendition: RenditionConfig,
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
      "fast",
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
      logger.info({ rendition: rendition.name, cwd: renditionDir }, "Starting FFmpeg rendition spawn");

      const proc = spawn(resolvedFfmpegPath, args, {
        cwd: renditionDir,
        windowsHide: true,
      });

      let stderrOutput = "";

      proc.stderr.on("data", (data) => {
        const str = data.toString();
        stderrOutput += str;

        // Extract progress if available
        if (onProgress) {
          const timeMatch = str.match(/time=(\d+):(\d+):(\d+\.\d+)/);
          if (timeMatch) {
            onProgress(50); // General progress marker
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
