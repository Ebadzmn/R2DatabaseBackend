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

    const session = uploadSessionId ? await UploadSession.findById(uploadSessionId) : null;
    const isEpisode = !!(session?.episodeId || session?.seasonNumber || session?.episodeNumber);

    const workDir = path.join(process.cwd(), "tmp", `proc-${movieId}-${Date.now()}`);
    const sourceFilePath = path.join(workDir, path.basename(sourceObjectKey));
    const hlsOutputDir = path.join(workDir, "hls");

    const updateProcessingProgress = async (progressPercent: number) => {
      if (isEpisode && session) {
        if (session.episodeId) {
          await Movie.updateOne(
            { _id: movie._id, "episodes._id": session.episodeId },
            { $set: { "episodes.$.status": "PROCESSING", "episodes.$.processingProgress": progressPercent } }
          ).catch(() => {});
        } else if (session.seasonNumber && session.episodeNumber) {
          await Movie.updateOne(
            {
              _id: movie._id,
              "episodes.seasonNumber": session.seasonNumber,
              "episodes.episodeNumber": session.episodeNumber
            },
            { $set: { "episodes.$.status": "PROCESSING", "episodes.$.processingProgress": progressPercent } }
          ).catch(() => {});
        }
      } else {
        await Movie.findByIdAndUpdate(movie._id, {
          $set: { status: "PROCESSING", processingProgress: progressPercent }
        }).catch(() => {});
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

      logger.info({ movieId, sourceObjectKey, isEpisode }, "Downloading source video from R2 for FFmpeg processing");

      // 1. Download source video stream from R2
      const downloadStream = await R2Service.getObjectStream(storageAccount, sourceObjectKey);
      await pipeline(downloadStream, createWriteStream(sourceFilePath));

      logger.info({ movieId, sourceFilePath }, "Source video downloaded, probing media metadata");

      // 2. FFprobe media inspection
      const probe = await MediaMetadataService.probe(sourceFilePath);

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

      // 3. Determine if video can be fast-remuxed (already <= 720p H.264/AAC)
      const canFastRemux = FFmpegService.canFastRemuxHLS(probe);
      const renditions = FFmpegService.selectRenditions(probe);

      if (canFastRemux) {
        logger.info(
          { movieId, resolution: probe.resolution, videoCodec: probe.videoCodec },
          "Video is already in optimal streaming format (<= 720p H264). Bypassing heavy re-encode with instant HLS stream copy."
        );

        await updateProcessingProgress(40);

        // Ultra fast stream copy: 100x faster (Takes 2-3 seconds!)
        await FFmpegService.generateFastDirectHLS(sourceFilePath, hlsOutputDir, (percent) => {
          updateProcessingProgress(40 + Math.round(percent * 0.35)).catch(() => {});
        });

        // Generate master playlist for the 720p stream
        await FFmpegService.generateMasterPlaylist(hlsOutputDir, [{
          name: "720p",
          resolution: probe.resolution || "1280x720",
          width: probe.width || 1280,
          height: probe.height || 720,
          videoBitrate: "2500k",
          audioBitrate: "128k",
          bandwidth: 2800000
        }]);
      } else {
        logger.info(
          { movieId, renditions: renditions.map((r) => r.name) },
          "Selected multi-rendition HLS encoding ladder"
        );

        // 4. Generate HLS for each rendition with multi-core acceleration
        let completedRenditions = 0;
        let lastReportedProgress = 20;
        const totalDuration = probe.duration || 0;

        for (const rendition of renditions) {
          await FFmpegService.generateRendition(
            sourceFilePath,
            hlsOutputDir,
            rendition,
            totalDuration,
            (percent) => {
              const overall = 20 + Math.round(((completedRenditions + percent / 100) / renditions.length) * 55);
              if (overall > lastReportedProgress) {
                lastReportedProgress = overall;
                updateProcessingProgress(overall).catch(() => {});
              }
            }
          );
          completedRenditions++;
        }

        // 5. Generate master.m3u8 playlist
        await FFmpegService.generateMasterPlaylist(hlsOutputDir, renditions);
      }

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
      const uploadedBytes = await this.uploadDirectoryToR2(storageAccount, hlsOutputDir, hlsPrefix);

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
