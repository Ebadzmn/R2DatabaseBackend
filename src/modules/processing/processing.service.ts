import path from "path";
import fs from "fs/promises";
import { createWriteStream, existsSync } from "fs";
import { pipeline } from "stream/promises";
import { Movie, IMovie } from "../movies/movie.model";
import { StorageAccount } from "../storage/storage.model";
import { UploadSession } from "../upload/upload.model";
import { R2Service } from "../storage/r2.service";
import { MediaMetadataService } from "../../services/media-metadata.service";
import { FFmpegService, RenditionConfig } from "./ffmpeg.service";
import { logger } from "../../utils/logger";

export class ProcessingService {
  /**
   * Processes an uploaded video into HLS streams and uploads the resulting playlist/segments to R2
   */
  public static async processVideo(data: {
    movieId: string;
    uploadSessionId: string;
    storageAccountId: string;
    sourceObjectKey: string;
  }): Promise<void> {
    const { movieId, uploadSessionId, storageAccountId, sourceObjectKey } = data;

    const movie = await Movie.findById(movieId);
    if (!movie) {
      throw new Error(`Movie ${movieId} not found for processing`);
    }

    const storageAccount = await StorageAccount.findById(storageAccountId);
    if (!storageAccount) {
      throw new Error(`Storage account ${storageAccountId} not found for processing`);
    }

    const session = await UploadSession.findById(uploadSessionId);

    const workDir = path.join(process.cwd(), "tmp", `proc-${movieId}-${Date.now()}`);
    const sourceFilePath = path.join(workDir, path.basename(sourceObjectKey));
    const hlsOutputDir = path.join(workDir, "hls");

    try {
      await fs.mkdir(workDir, { recursive: true });
      await fs.mkdir(hlsOutputDir, { recursive: true });

      movie.status = "PROCESSING";
      movie.processingProgress = 5;
      await movie.save();

      if (session) {
        session.status = "PROCESSING";
        session.progress = 5;
        await session.save();
      }

      logger.info({ movieId, sourceObjectKey }, "Downloading source video from R2 for FFmpeg processing");

      // 1. Download source video stream from R2
      const downloadStream = await R2Service.getObjectStream(storageAccount, sourceObjectKey);
      await pipeline(downloadStream, createWriteStream(sourceFilePath));

      logger.info({ movieId, sourceFilePath }, "Source video downloaded, probing media metadata");

      // 2. FFprobe media inspection
      const probe = await MediaMetadataService.probe(sourceFilePath);

      movie.videoCodec = probe.videoCodec;
      movie.audioCodec = probe.audioCodec;
      movie.resolution = probe.resolution;
      movie.duration = probe.duration;
      movie.processingProgress = 20;
      await movie.save();

      // 3. Determine target renditions
      const renditions = FFmpegService.selectRenditions(probe);
      logger.info(
        { movieId, renditions: renditions.map((r) => r.name) },
        "Selected HLS rendition ladder"
      );

      // 4. Generate HLS for each rendition
      let completedRenditions = 0;
      let lastReportedProgress = 20;

      for (const rendition of renditions) {
        await FFmpegService.generateRendition(
          sourceFilePath,
          hlsOutputDir,
          rendition,
          (percent) => {
            const overall = 20 + Math.round(((completedRenditions + percent / 100) / renditions.length) * 50);
            if (overall > lastReportedProgress) {
              lastReportedProgress = overall;
              Movie.findByIdAndUpdate(movie._id, { $set: { processingProgress: overall } }).catch(() => {});
            }
          }
        );
        completedRenditions++;
      }

      // 5. Generate master.m3u8 playlist
      await FFmpegService.generateMasterPlaylist(hlsOutputDir, renditions);
      await Movie.findByIdAndUpdate(movie._id, { $set: { processingProgress: 75 } });

      // 6. Upload all generated HLS files to R2
      logger.info({ movieId, hlsOutputDir }, "Uploading HLS files to R2 bucket");
      const hlsPrefix = `movies/${movie.slug}/${movie._id.toString()}/hls`;
      const uploadedBytes = await this.uploadDirectoryToR2(storageAccount, hlsOutputDir, hlsPrefix);

      // Account for the additional storage used by the HLS segments
      await StorageAccount.findByIdAndUpdate(storageAccount._id, {
        $inc: { usedStorageBytes: uploadedBytes },
      });

      // 7. Update Movie status to READY
      const masterKey = `${hlsPrefix}/master.m3u8`;
      await Movie.findByIdAndUpdate(movie._id, {
        $set: {
          status: "READY",
          hlsMasterKey: masterKey,
          hlsStorageId: storageAccount._id,
          processingProgress: 100,
          processingError: null,
        },
      });

      if (session) {
        await UploadSession.findByIdAndUpdate(session._id, {
          $set: { status: "COMPLETED", progress: 100 },
        });
      }

      logger.info(
        { movieId, masterKey, uploadedHlsBytes: uploadedBytes },
        "Movie video processing and HLS generation completed successfully"
      );
    } catch (error: any) {
      logger.error({ err: error, movieId }, "Video processing failed");

      await Movie.findByIdAndUpdate(movie._id, {
        $set: {
          status: "FAILED",
          processingError: error?.message || "Video processing failed",
        },
      }).catch(() => {});

      if (session) {
        await UploadSession.findByIdAndUpdate(session._id, {
          $set: {
            status: "FAILED",
            error: error?.message || "Video processing failed",
          },
        }).catch(() => {});
      }

      throw error;
    } finally {
      // 8. Clean up local temporary files
      try {
        if (existsSync(workDir)) {
          await fs.rm(workDir, { recursive: true, force: true });
        }
      } catch (cleanErr) {
        logger.warn({ cleanErr, workDir }, "Failed to delete temporary processing directory");
      }
    }
  }

  /**
   * Recursively uploads a local directory to R2 with proper MIME types and returns total bytes uploaded
   */
  private static async uploadDirectoryToR2(
    storageAccount: StorageAccountType,
    localDir: string,
    r2Prefix: string
  ): Promise<number> {
    let totalBytes = 0;

    const walk = async (currentDir: string, subPath = "") => {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullLocalPath = path.join(currentDir, entry.name);
        const relativeKey = subPath ? `${subPath}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          await walk(fullLocalPath, relativeKey);
        } else if (entry.isFile()) {
          const fileBuffer = await fs.readFile(fullLocalPath);
          const r2Key = `${r2Prefix}/${relativeKey}`.replace(/\\/g, "/");

          let contentType = "application/octet-stream";
          if (entry.name.endsWith(".m3u8")) {
            contentType = "application/vnd.apple.mpegurl";
          } else if (entry.name.endsWith(".ts")) {
            contentType = "video/mp2t";
          }

          await R2Service.putObject(storageAccount, r2Key, fileBuffer, contentType);
          totalBytes += fileBuffer.length;
        }
      }
    };

    await walk(localDir);
    return totalBytes;
  }
}

type StorageAccountType = any;
