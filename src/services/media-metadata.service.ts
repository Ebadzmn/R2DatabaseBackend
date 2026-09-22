import ffmpeg from "fluent-ffmpeg";
import { env } from "../config/env";
import { logger } from "../utils/logger";

// Configure FFprobe binary path
try {
  if (env.FFPROBE_PATH) {
    ffmpeg.setFfprobePath(env.FFPROBE_PATH);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ffprobeInstaller = require("@ffprobe-installer/ffprobe");
    if (ffprobeInstaller?.path) {
      ffmpeg.setFfprobePath(ffprobeInstaller.path);
    }
  }
} catch (e) {
  logger.warn({ err: e }, "Could not set automatic ffprobe path, relying on system PATH");
}

export interface MediaProbeResult {
  duration: number; // in seconds
  width: number;
  height: number;
  resolution: string; // e.g., "1920x1080", "1280x720"
  videoCodec: string;
  audioCodec: string;
  bitrate: number;
  fps: number;
  audioTracks: number;
  subtitleTracks: number;
}

export class MediaMetadataService {
  /**
   * Probes video file or stream using FFprobe to detect codecs, resolution, and audio tracks
   */
  public static async probe(filePath: string): Promise<MediaProbeResult> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) {
          logger.error({ err, filePath }, "FFprobe failed to inspect media file");
          return reject(new Error(`FFprobe inspection failed: ${err.message}`));
        }

        const videoStream = metadata.streams.find((s) => s.codec_type === "video");
        const audioStreams = metadata.streams.filter((s) => s.codec_type === "audio");
        const subtitleStreams = metadata.streams.filter((s) => s.codec_type === "subtitle");

        const width = videoStream?.width || 0;
        const height = videoStream?.height || 0;
        const duration = Number(metadata.format.duration) || 0;
        const bitrate = Number(metadata.format.bit_rate) || 0;

        // Calculate framerate
        let fps = 24;
        if (videoStream?.r_frame_rate) {
          const [num, den] = videoStream.r_frame_rate.split("/").map(Number);
          if (den && den > 0) {
            fps = Math.round(num / den);
          }
        }

        const result: MediaProbeResult = {
          duration: Math.round(duration),
          width,
          height,
          resolution: width && height ? `${width}x${height}` : "Unknown",
          videoCodec: videoStream?.codec_name || "unknown",
          audioCodec: audioStreams[0]?.codec_name || "unknown",
          bitrate,
          fps,
          audioTracks: audioStreams.length,
          subtitleTracks: subtitleStreams.length
        };

        logger.info({ filePath, result }, "Media probed successfully");
        resolve(result);
      });
    });
  }
}
