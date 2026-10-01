import path from "path";
import fs from "fs/promises";
import { createWriteStream, existsSync } from "fs";
import { pipeline } from "stream/promises";
import { Movie, IMovie } from "../movies/movie.model";
import { StorageAccount } from "../storage/storage.model";
import { UploadSession } from "../upload/upload.model";
import { R2Service } from "../storage/r2.service";
import { MediaMetadataService, MediaProbeResult } from "../../services/media-metadata.service";
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

    const session = uploadSessionId ? await UploadSession.findById(uploadSessionId) : null;
    const isEpisode = !!(session?.episodeId || session?.seasonNumber || session?.episodeNumber);

    const workDir = path.join(process.cwd(), "tmp", `proc-${movieId}-${Date.now()}`);
    const sourceFilePath = path.join(workDir, path.basename(sourceObjectKey));
    const hlsOutputDir = path.join(workDir, "hls");

    const updateProcessingProgress = async (progressPercent: number) => {
      if (session) {
        await UploadSession.updateOne(
          { _id: session._id, status: { $nin: ["COMPLETED", "FAILED", "ABORTED"] } },
          { $set: { status: "PROCESSING", progress: progressPercent } }
        ).catch(() => {});
      }

      if (isEpisode && session) {
        if (session.episodeId) {
          await Movie.updateOne(
            { _id: movie._id, "episodes._id": session.episodeId, "episodes.status": { $ne: "READY" } },
            { $set: { "episodes.$.status": "PROCESSING", "episodes.$.processingProgress": progressPercent } }
          ).catch(() => {});
        } else if (session.seasonNumber && session.episodeNumber) {
          await Movie.updateOne(
            {
              _id: movie._id,
              "episodes.seasonNumber": session.seasonNumber,
              "episodes.episodeNumber": session.episodeNumber,
              "episodes.status": { $ne: "READY" }
            },
            { $set: { "episodes.$.status": "PROCESSING", "episodes.$.processingProgress": progressPercent } }
          ).catch(() => {});
        }
      } else {
        await Movie.updateOne(
          { _id: movie._id, status: { $ne: "READY" } },
          { $set: { status: "PROCESSING", processingProgress: progressPercent } }
        ).catch(() => {});
      }
    };

    try {
      await fs.mkdir(workDir, { recursive: true });
      await fs.mkdir(hlsOutputDir, { recursive: true });

      await updateProcessingProgress(5);

      if (session) {
        session.status = "PROCESSING";
        session.progress = 5;
        await session.save();
      }

      // 1. Zero-Disk Streaming: Resolve direct R2 stream URL (via public URL or presigned GET)
      let sourceInput = "";
      try {
        if (storageAccount.publicUrl) {
          const cleanBase = storageAccount.publicUrl.replace(/\/+$/, "");
          const cleanKey = sourceObjectKey.replace(/^\/+/, "");
          sourceInput = `${cleanBase}/${cleanKey}`;
        } else {
          sourceInput = await R2Service.getPresignedGetUrl(storageAccount, sourceObjectKey, 7200);
        }
        logger.info({ movieId, sourceInput }, "Connecting direct R2 streaming pipeline for FFprobe & FFmpeg");
      } catch (urlErr: any) {
        logger.warn({ urlErr: urlErr?.message }, "Failed to generate presigned R2 URL, falling back to local file download");
      }

      // 2. FFprobe media inspection (Streamed directly from R2, 0s download wait!)
      let probe: MediaProbeResult;
      try {
        if (!sourceInput) throw new Error("No R2 streaming URL available");
        probe = await MediaMetadataService.probe(sourceInput);
      } catch (probeErr: any) {
        logger.warn(
          { probeErr: probeErr?.message, movieId },
          "Direct R2 stream probe encountered an issue, falling back to local file download"
        );
        const downloadStream = await R2Service.getObjectStream(storageAccount, sourceObjectKey);
        await pipeline(downloadStream, createWriteStream(sourceFilePath));
        sourceInput = sourceFilePath;
        probe = await MediaMetadataService.probe(sourceFilePath);
      }

      if (isEpisode && session) {
        if (session.episodeId) {
          await Movie.updateOne(
            { _id: movie._id, "episodes._id": session.episodeId },
            {
              $set: {
                "episodes.$.videoCodec": probe.videoCodec,
                "episodes.$.audioCodec": probe.audioCodec,
                "episodes.$.resolution": probe.resolution,
                "episodes.$.duration": probe.duration,
                "episodes.$.processingProgress": 20
              }
            }
          ).catch(() => {});
        } else if (session.seasonNumber && session.episodeNumber) {
          await Movie.updateOne(
            {
              _id: movie._id,
              "episodes.seasonNumber": session.seasonNumber,
              "episodes.episodeNumber": session.episodeNumber
            },
            {
              $set: {
                "episodes.$.videoCodec": probe.videoCodec,
                "episodes.$.audioCodec": probe.audioCodec,
                "episodes.$.resolution": probe.resolution,
                "episodes.$.duration": probe.duration,
                "episodes.$.processingProgress": 20
              }
            }
          ).catch(() => {});
        }
      } else {
        movie.videoCodec = probe.videoCodec;
        movie.audioCodec = probe.audioCodec;
        movie.resolution = probe.resolution;
        movie.duration = probe.duration;
        movie.processingProgress = 20;
        await movie.save();
      }

      // 3. Select renditions ladder based on input probe (1080p & 720p if >= 1080p, or 720p)
      const renditions = FFmpegService.selectRenditions(probe);

      logger.info(
        { movieId, renditions: renditions.map((r) => r.name), resolution: probe.resolution },
        "Selected adaptive multi-rendition HLS encoding ladder"
      );

      // 4. Generate Renditions HLS
      const totalDuration = probe.duration || 0;

      await FFmpegService.generateRenditionsHLS(
        sourceInput,
        hlsOutputDir,
        renditions,
        totalDuration,
        (percent) => {
          const overall = 20 + Math.round((percent / 100) * 60);
          updateProcessingProgress(overall).catch(() => {});
        }
      );

      // 5. Generate master.m3u8 playlist combining all renditions
      await FFmpegService.generateMasterPlaylist(hlsOutputDir, renditions);

      await updateProcessingProgress(80);

      // 6. Upload all generated HLS files to R2
      logger.info({ movieId, hlsOutputDir }, "Uploading HLS files to R2 bucket");

      let hlsPrefix = `movies/${movie.slug}/${movie._id.toString()}/hls`;
      if (isEpisode && session) {
        const sNum = session.seasonNumber || 1;
        const eNum = session.episodeNumber || 1;
        hlsPrefix = `series/${movie.slug}/season-${sNum}/episode-${eNum}/hls`;
      }

      await updateProcessingProgress(85);
      let lastUploadPercent = 85;
      const uploadedBytes = await this.uploadDirectoryToR2(
        storageAccount,
        hlsOutputDir,
        hlsPrefix,
        async (uploaded, total) => {
          const p = Math.min(99, 85 + Math.round((uploaded / total) * 14));
          if (p > lastUploadPercent) {
            lastUploadPercent = p;
            await updateProcessingProgress(p);
          }
        }
      );

      // Account for the additional storage used by the HLS segments
      await StorageAccount.findByIdAndUpdate(storageAccount._id, {
        $inc: { usedStorageBytes: uploadedBytes },
      });

      // 7. Update Movie or Episode status to READY
      const masterKey = `${hlsPrefix}/master.m3u8`;

      if (isEpisode && session) {
        if (session.episodeId) {
          await Movie.updateOne(
            { _id: movie._id, "episodes._id": session.episodeId },
            {
              $set: {
                "episodes.$.status": "READY",
                "episodes.$.hlsMasterKey": masterKey,
                "episodes.$.hlsStorageId": storageAccount._id,
                "episodes.$.processingProgress": 100,
                "episodes.$.processingError": null
              }
            }
          );
        } else if (session.seasonNumber && session.episodeNumber) {
          await Movie.updateOne(
            {
              _id: movie._id,
              "episodes.seasonNumber": session.seasonNumber,
              "episodes.episodeNumber": session.episodeNumber
            },
            {
              $set: {
                "episodes.$.status": "READY",
                "episodes.$.hlsMasterKey": masterKey,
                "episodes.$.hlsStorageId": storageAccount._id,
                "episodes.$.processingProgress": 100,
                "episodes.$.processingError": null
              }
            }
          );
        }

        // If all episodes in series or series itself needs a ready badge
        await Movie.findByIdAndUpdate(movie._id, {
          $set: { status: "READY" }
        });
      } else {
        await Movie.findByIdAndUpdate(movie._id, {
          $set: {
            status: "READY",
            hlsMasterKey: masterKey,
            hlsStorageId: storageAccount._id,
            processingProgress: 100,
            processingError: null,
          },
        });
      }

      if (session) {
        await UploadSession.findByIdAndUpdate(session._id, {
          $set: { status: "COMPLETED", progress: 100 },
        });
      }

      logger.info(
        { movieId, masterKey, uploadedHlsBytes: uploadedBytes, isEpisode },
        "Video processing and HLS generation completed successfully"
      );
    } catch (error: any) {
      logger.error({ err: error, movieId }, "Video processing failed");

      if (isEpisode && session) {
        if (session.episodeId) {
          await Movie.updateOne(
            { _id: movie._id, "episodes._id": session.episodeId },
            { $set: { "episodes.$.status": "FAILED", "episodes.$.processingError": error?.message } }
          ).catch(() => {});
        }
      } else {
        await Movie.findByIdAndUpdate(movie._id, {
          $set: {
            status: "FAILED",
            processingError: error?.message || "Video processing failed",
          },
        }).catch(() => {});
      }

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
    r2Prefix: string,
    onProgress?: (uploadedFiles: number, totalFiles: number) => void
  ): Promise<number> {
    interface FileToUpload {
      fullPath: string;
      r2Key: string;
      contentType: string;
    }

    const filesToUpload: FileToUpload[] = [];

    const walk = async (currentDir: string, subPath = "") => {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullLocalPath = path.join(currentDir, entry.name);
        const relativeKey = subPath ? `${subPath}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          await walk(fullLocalPath, relativeKey);
        } else if (entry.isFile()) {
          const r2Key = `${r2Prefix}/${relativeKey}`.replace(/\\/g, "/");

          let contentType = "application/octet-stream";
          if (entry.name.endsWith(".m3u8")) {
            contentType = "application/vnd.apple.mpegurl";
          } else if (entry.name.endsWith(".ts")) {
            contentType = "video/mp2t";
          }

          filesToUpload.push({ fullPath: fullLocalPath, r2Key, contentType });
        }
      }
    };

    await walk(localDir);

    let totalBytes = 0;
    let completedCount = 0;
    const CONCURRENCY = 10;

    for (let i = 0; i < filesToUpload.length; i += CONCURRENCY) {
      const batch = filesToUpload.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async (file) => {
          const fileBuffer = await fs.readFile(file.fullPath);
          await R2Service.putObject(storageAccount, file.r2Key, fileBuffer, file.contentType);
          totalBytes += fileBuffer.length;
          completedCount++;
          if (onProgress) {
            await onProgress(completedCount, filesToUpload.length);
          }
        })
      );
    }

    return totalBytes;
  }
}

type StorageAccountType = any;
