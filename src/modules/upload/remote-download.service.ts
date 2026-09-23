import axios, { AxiosResponse } from "axios";
import { Types } from "mongoose";
import path from "path";
import { UploadSession, IUploadSession } from "./upload.model";
import { Movie, IMovie } from "../movies/movie.model";
import { StorageAccount } from "../storage/storage.model";
import { StorageManagerService } from "../../services/storage-manager.service";
import { R2Service, PartETag } from "../storage/r2.service";
import { remoteDownloadQueue } from "../processing/processing.queue";
import { UploadService } from "./upload.service";
import { slugify } from "../../utils/slugify";
import { NotFoundError, BadRequestError } from "../../utils/errors";
import { logger } from "../../utils/logger";
import { InitRemoteDownloadInput } from "./upload.validation";

// Minimum part size for S3/R2 multipart uploads is 5MB. We use 10MB chunks for peak network throughput.
const PART_SIZE = 10 * 1024 * 1024; // 10MB

export class RemoteDownloadService {
  // Store active abort controllers so users can cancel downloads mid-stream
  private static activeControllers = new Map<string, AbortController>();
  private static inProgressSessions = new Set<string>();

  /**
   * Initializes remote URL auto-download session, reserves storage, and dispatches download
   */
  public static async initRemoteDownload(input: InitRemoteDownloadInput): Promise<{
    uploadSessionId: string;
    sessionId?: string;
    movieId?: string;
    fileName: string;
    fileSize: number;
    status: string;
  }> {
    const targetUrl = input.url.trim();

    // 1. Inspect remote URL to determine file metadata (Content-Length, Content-Type, filename)
    let remoteFileSize = 0;
    let remoteContentType = "video/mp4";
    let detectedFileName = input.fileName?.trim();

    try {
      const headRes = await axios.head(targetUrl, {
        timeout: 15000,
        maxRedirects: 10,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Accept: "*/*"
        },
        validateStatus: (status) => status >= 200 && status < 400
      });

      const cl = headRes.headers["content-length"];
      if (cl) {
        remoteFileSize = parseInt(String(cl), 10);
      }

      const ct = headRes.headers["content-type"];
      if (ct && !String(ct).includes("text/html")) {
        remoteContentType = String(ct).split(";")[0].trim();
      }

      // Try extract filename from Content-Disposition header if available
      const cd = headRes.headers["content-disposition"];
      if (!detectedFileName && cd) {
        const match = String(cd).match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
        if (match && match[1]) {
          detectedFileName = match[1].replace(/['"]/g, "").trim();
        }
      }
    } catch (headErr: any) {
      logger.warn(
        { url: targetUrl, err: headErr?.message },
        "HEAD request failed on remote URL, falling back to streaming inspection"
      );
    }

    // 2. Infer filename if still unknown
    if (!detectedFileName) {
      try {
        const parsedUrl = new URL(targetUrl);
        const basename = path.basename(parsedUrl.pathname);
        if (basename && basename.includes(".")) {
          detectedFileName = decodeURIComponent(basename);
        }
      } catch {}
    }

    if (!detectedFileName) {
      detectedFileName = `video_${Date.now()}.mp4`;
    }

    // Ensure has video extension
    if (!path.extname(detectedFileName)) {
      detectedFileName = `${detectedFileName}.mp4`;
    }

    // Default estimate if Content-Length was not exposed by remote server (e.g. dynamic chunked transfer)
    if (remoteFileSize <= 0) {
      remoteFileSize = 500 * 1024 * 1024; // 500MB initial reservation
    }

    // 3. Resolve target movie or series record
    let movie: IMovie | null = null;
    let movieSlug = "remote-video";
    let movieIdStr = new Types.ObjectId().toString();

    if (input.movieId) {
      movie = await Movie.findById(input.movieId);
      if (!movie) {
        throw new NotFoundError("Associated movie or series not found", "MOVIE_NOT_FOUND");
      }
      movieSlug = movie.slug;
      movieIdStr = movie._id.toString();
    } else {
      const title = detectedFileName.replace(/\.[^/.]+$/, "");
      movieSlug = slugify(title);
      movie = await Movie.create({
        _id: new Types.ObjectId(movieIdStr),
        title,
        slug: `${movieSlug}-${Date.now().toString().slice(-4)}`,
        status: "UPLOADING",
        fileSize: remoteFileSize
      });
    }

    // 4. Reserve capacity on active R2 storage account
    const storageAccount = await StorageManagerService.selectAndReserveStorage(
      remoteFileSize,
      input.storageAccountId
    );

    // 5. Build clean, collision-free object key in R2
    const cleanFileName = detectedFileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    let objectKey = `movies/${movieSlug}/${movieIdStr}/source/${cleanFileName}`;

    if (movie.type === "SERIES" && (input.seasonNumber || input.episodeNumber)) {
      const sNum = input.seasonNumber || 1;
      const eNum = input.episodeNumber || 1;
      objectKey = `series/${movieSlug}/season-${sNum}/episode-${eNum}/source/${cleanFileName}`;
    }

    // 6. Initialize Cloudflare R2 multipart upload session
    const mpResult = await R2Service.initMultipartUpload(
      storageAccount,
      objectKey,
      remoteContentType
    );

    let targetEpisodeObjectId: Types.ObjectId | undefined = undefined;
    if (input.episodeId) {
      targetEpisodeObjectId = new Types.ObjectId(input.episodeId);
    }

    // 7. Persist UploadSession record
    const session = await UploadSession.create({
      movieId: movie._id,
      episodeId: targetEpisodeObjectId,
      seasonNumber: input.seasonNumber,
      episodeNumber: input.episodeNumber,
      storageAccountId: storageAccount._id,
      objectKey,
      fileName: detectedFileName,
      fileSize: remoteFileSize,
      uploadId: mpResult.uploadId,
      status: "INITIALIZED",
      uploadedBytes: 0,
      progress: 0,
      sourceType: "REMOTE_URL",
      remoteUrl: targetUrl,
      downloadSpeedBytesPerSec: 0
    });

    const sessionIdStr = session._id.toString();

    // 8. Start background download execution immediately & register with BullMQ
    this.startBackgroundDownload(sessionIdStr).catch((err) => {
      logger.error({ err: err?.message, sessionId: sessionIdStr }, "Direct remote download failed");
    });

    remoteDownloadQueue
      .add(
        "remote-download",
        { sessionId: sessionIdStr },
        { jobId: `rdown-${sessionIdStr}` }
      )
      .catch((queueErr) => {
        logger.warn({ err: queueErr?.message }, "BullMQ remote download queue enqueue skipped");
      });

    logger.info(
      {
        sessionId: sessionIdStr,
        url: targetUrl,
        fileName: detectedFileName,
        fileSize: remoteFileSize
      },
      "Remote URL auto-download initialized successfully"
    );

    return {
      uploadSessionId: sessionIdStr,
      sessionId: sessionIdStr,
      movieId: movie._id.toString(),
      fileName: detectedFileName,
      fileSize: remoteFileSize,
      status: "INITIALIZED"
    };
  }

  /**
   * Executes the streaming transfer from remote URL directly to Cloudflare R2 multipart chunks
   */
  public static async startBackgroundDownload(sessionId: string): Promise<void> {
    if (this.inProgressSessions.has(sessionId)) {
      logger.info({ sessionId }, "Remote download session is already active");
      return;
    }

    const session = await UploadSession.findById(sessionId);
    if (!session || !session.remoteUrl || !session.uploadId) {
      logger.warn({ sessionId }, "Session invalid or missing remoteUrl / uploadId for remote download");
      return;
    }

    const storageAccount = await StorageAccount.findById(session.storageAccountId);
    if (!storageAccount) {
      throw new NotFoundError("Storage account not found", "STORAGE_NOT_FOUND");
    }

    this.inProgressSessions.add(sessionId);
    const abortController = new AbortController();
    this.activeControllers.set(sessionId, abortController);

    session.status = "DOWNLOADING";
    await session.save();

    const startTime = Date.now();
    let totalLoadedBytes = 0;
    let lastProgressDbUpdate = Date.now();
    const partsETags: PartETag[] = [];
    let partNumber = 1;

    try {
      logger.info({ sessionId, url: session.remoteUrl }, "Connecting to remote video source stream");

      const response: AxiosResponse<NodeJS.ReadableStream> = await axios.get(session.remoteUrl, {
        responseType: "stream",
        timeout: 30000,
        signal: abortController.signal,
        maxRedirects: 10,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Accept: "*/*"
        }
      });

      // Update actual Content-Length if discovered from stream response
      const streamContentLength = response.headers["content-length"];
      if (streamContentLength) {
        const parsedLength = parseInt(String(streamContentLength), 10);
        if (parsedLength > 0 && parsedLength !== session.fileSize) {
          session.fileSize = parsedLength;
          await session.save();
        }
      }

      // Memory buffer accumulator for 10MB chunk parts
      let chunkBuffers: Buffer[] = [];
      let currentChunkSize = 0;

      const uploadCurrentChunk = async (isFinal = false) => {
        if (chunkBuffers.length === 0) return;

        const combinedBuffer = Buffer.concat(chunkBuffers, currentChunkSize);
        chunkBuffers = [];
        currentChunkSize = 0;

        logger.info(
          { sessionId, partNumber, size: combinedBuffer.length, isFinal },
          "Uploading chunk part to Cloudflare R2"
        );

        const etag = await R2Service.uploadPart(
          storageAccount,
          session.objectKey,
          session.uploadId!,
          partNumber,
          combinedBuffer
        );

        partsETags.push({ PartNumber: partNumber, ETag: etag });
        partNumber++;
      };

      for await (const chunk of response.data) {
        if (abortController.signal.aborted) {
          throw new Error("Download cancelled by user");
        }

        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        chunkBuffers.push(buf);
        currentChunkSize += buf.length;
        totalLoadedBytes += buf.length;

        // When accumulator reaches 10MB, push chunk directly to R2 multipart
        if (currentChunkSize >= PART_SIZE) {
          await uploadCurrentChunk(false);
        }

        // Throttle progress updates to DB (every 1 second)
        const now = Date.now();
        if (now - lastProgressDbUpdate >= 1000) {
          const elapsedSec = (now - startTime) / 1000 || 0.001;
          const speed = Math.round(totalLoadedBytes / elapsedSec);
          const percent = session.fileSize > 0
            ? Math.min(99, Math.round((totalLoadedBytes / session.fileSize) * 100))
            : 50;
          const remainingBytes = Math.max(0, session.fileSize - totalLoadedBytes);
          const eta = speed > 0 ? Math.ceil(remainingBytes / speed) : undefined;

          await UploadSession.updateOne(
            { _id: session._id },
            {
              uploadedBytes: totalLoadedBytes,
              progress: percent,
              downloadSpeedBytesPerSec: speed,
              etaSeconds: eta,
              status: "DOWNLOADING"
            }
          );

          lastProgressDbUpdate = now;
        }
      }

      // Upload remaining buffered bytes (final part)
      if (currentChunkSize > 0) {
        await uploadCurrentChunk(true);
      }

      logger.info(
        { sessionId, totalParts: partsETags.length, totalLoadedBytes },
        "Remote stream fully received. Committing multipart upload on R2..."
      );

      // Finalize and commit R2 multipart upload
      session.fileSize = totalLoadedBytes;
      session.uploadedBytes = totalLoadedBytes;
      session.progress = 100;
      session.status = "COMPLETING";
      await session.save();

      // Complete upload and trigger BullMQ FFmpeg HLS transcoding
      await UploadService.completeUpload(session._id.toString(), partsETags);

      logger.info({ sessionId, totalLoadedBytes }, "Remote URL download & R2 ingestion finished successfully");
    } catch (err: any) {
      if (abortController.signal.aborted || err.message === "Download cancelled by user") {
        logger.warn({ sessionId }, "Remote download was aborted by user");
        await UploadService.abortUpload(sessionId).catch(() => {});
      } else {
        logger.error({ err: err?.message, sessionId }, "Remote download stream failed");
        session.status = "FAILED";
        session.error = err?.message || "Failed to download remote file";
        await session.save();
        await StorageManagerService.releaseStorage(session.storageAccountId, session.fileSize).catch(() => {});
      }
      throw err;
    } finally {
      this.inProgressSessions.delete(sessionId);
      this.activeControllers.delete(sessionId);
    }
  }

  /**
   * Cancels/aborts an active remote download
   */
  public static async cancelRemoteDownload(sessionId: string): Promise<IUploadSession> {
    const controller = this.activeControllers.get(sessionId);
    if (controller) {
      controller.abort();
      this.activeControllers.delete(sessionId);
    }

    return UploadService.abortUpload(sessionId);
  }
}
