import { Types } from "mongoose";
import { UploadSession, IUploadSession } from "./upload.model";
import { Movie, IMovie } from "../movies/movie.model";
import { StorageAccount } from "../storage/storage.model";
import { StorageManagerService } from "../../services/storage-manager.service";
import { R2Service, PartETag } from "../storage/r2.service";
import { videoProcessingQueue } from "../processing/processing.queue";
import { ProcessingService } from "../processing/processing.service";
import { slugify } from "../../utils/slugify";
import { NotFoundError, BadRequestError } from "../../utils/errors";
import { logger } from "../../utils/logger";
import { InitUploadInput } from "./upload.validation";
import { env } from "../../config/env";

export class UploadService {
  /**
   * Initializes a direct-to-R2 upload session
   */
  public static async initUpload(input: InitUploadInput): Promise<{
    uploadSessionId: string;
    uploadId?: string;
    storageAccountId: string;
    objectKey: string;
    directPutUrl?: string;
    partUrls?: { partNumber: number; url: string }[];
    status: string;
  }> {
    let movie: IMovie | null = null;
    let movieSlug = "upload";
    let movieIdStr = new Types.ObjectId().toString();

    if (input.movieId) {
      movie = await Movie.findById(input.movieId);
      if (!movie) {
        throw new NotFoundError("Associated movie not found", "MOVIE_NOT_FOUND");
      }
      movieSlug = movie.slug;
      movieIdStr = movie._id.toString();
    } else {
      // Create a draft movie container for this upload
      const title = input.fileName.replace(/\.[^/.]+$/, "");
      movieSlug = slugify(title);
      movie = await Movie.create({
        _id: new Types.ObjectId(movieIdStr),
        title,
        slug: `${movieSlug}-${Date.now().toString().slice(-4)}`,
        status: "UPLOADING",
        fileSize: input.fileSize
      });
    }

    // Select and atomically reserve storage capacity
    const storageAccount = await StorageManagerService.selectAndReserveStorage(input.fileSize);

    // Predictable and collision-free object key: movies/{movieSlug}/{movieId}/source/{fileName}
    const cleanFileName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const objectKey = `movies/${movieSlug}/${movieIdStr}/source/${cleanFileName}`;

    let uploadId: string | undefined = undefined;
    let directPutUrl: string | undefined = undefined;
    const partUrls: { partNumber: number; url: string }[] = [];

    // For files >= 50MB, initialize multipart upload; for smaller files, provide presigned PUT URL
    const isMultipart = input.fileSize >= 50 * 1024 * 1024 || (input.partCount && input.partCount > 1);

    if (isMultipart) {
      const mpResult = await R2Service.initMultipartUpload(
        storageAccount,
        objectKey,
        input.contentType
      );
      uploadId = mpResult.uploadId;

      // Pre-generate initial batch of part URLs if partCount is specified
      const initialParts = Math.min(input.partCount || 10, 20);
      for (let i = 1; i <= initialParts; i++) {
        const url = await R2Service.getPresignedPartUrl(
          storageAccount,
          objectKey,
          uploadId,
          i,
          7200
        );
        partUrls.push({ partNumber: i, url });
      }
    } else {
      // Direct presigned PUT for smaller files
      directPutUrl = await R2Service.getPresignedPutUrl(
        storageAccount,
        objectKey,
        input.contentType,
        7200
      );
    }

    const session = await UploadSession.create({
      movieId: movie._id,
      storageAccountId: storageAccount._id,
      objectKey,
      fileName: input.fileName,
      fileSize: input.fileSize,
      uploadId,
      status: "INITIALIZED",
      uploadedBytes: 0,
      progress: 0
    });

    // Update movie with storage details
    movie.sourceStorageId = storageAccount._id;
    movie.hlsStorageId = storageAccount._id;
    movie.sourceObjectKey = objectKey;
    movie.status = "UPLOADING";
    movie.fileSize = input.fileSize;
    await movie.save();

    logger.info(
      {
        sessionId: session._id,
        movieId: movie._id,
        storageId: storageAccount._id,
        isMultipart,
        objectKey
      },
      "Upload session initialized successfully"
    );

    return {
      uploadSessionId: session._id.toString(),
      uploadId,
      storageAccountId: storageAccount._id.toString(),
      objectKey,
      directPutUrl,
      partUrls: partUrls.length > 0 ? partUrls : undefined,
      status: session.status
    };
  }

  /**
   * Generates additional presigned part URLs on demand for large uploads
   */
  public static async getPartUrls(
    sessionId: string,
    startPart: number,
    count: number
  ): Promise<{ partNumber: number; url: string }[]> {
    const session = await UploadSession.findById(sessionId);
    if (!session) {
      throw new NotFoundError("Upload session not found", "UPLOAD_NOT_FOUND");
    }

    if (!session.uploadId) {
      throw new BadRequestError("This upload session does not use multipart upload", "INVALID_REQUEST");
    }

    const storageAccount = await StorageAccount.findById(session.storageAccountId);
    if (!storageAccount) {
      throw new NotFoundError("Storage account not found", "STORAGE_NOT_FOUND");
    }

    const partUrls: { partNumber: number; url: string }[] = [];
    const maxPart = startPart + count - 1;

    for (let partNumber = startPart; partNumber <= maxPart; partNumber++) {
      const url = await R2Service.getPresignedPartUrl(
        storageAccount,
        session.objectKey,
        session.uploadId,
        partNumber,
        7200
      );
      partUrls.push({ partNumber, url });
    }

    return partUrls;
  }

  /**
   * Uploads a chunk part buffer directly to R2 and updates live progress in DB
   */
  public static async uploadPart(
    sessionId: string,
    partNumber: number,
    chunkBuffer: Buffer
  ): Promise<{ partNumber: number; etag: string; uploadedBytes: number; progress: number }> {
    const session = await UploadSession.findById(sessionId);
    if (!session) {
      throw new NotFoundError("Upload session not found", "UPLOAD_NOT_FOUND");
    }

    if (!session.uploadId) {
      throw new BadRequestError("This upload session does not use multipart upload", "INVALID_REQUEST");
    }

    const storageAccount = await StorageAccount.findById(session.storageAccountId);
    if (!storageAccount) {
      throw new NotFoundError("Storage account not found", "STORAGE_NOT_FOUND");
    }

    const etag = await R2Service.uploadPart(
      storageAccount,
      session.objectKey,
      session.uploadId,
      partNumber,
      chunkBuffer
    );

    // Increment uploadedBytes accurately and update progress
    session.uploadedBytes = Math.min(session.fileSize, session.uploadedBytes + chunkBuffer.length);
    session.progress = Math.min(99, Math.round((session.uploadedBytes / session.fileSize) * 100));
    session.status = "UPLOADING";
    await session.save();

    return {
      partNumber,
      etag,
      uploadedBytes: session.uploadedBytes,
      progress: session.progress
    };
  }

  /**
   * Uploads a single file buffer directly to R2 (for single-part files)
   */
  public static async uploadDirect(
    sessionId: string,
    fileBuffer: Buffer,
    contentType = "video/mp4"
  ): Promise<any> {
    const session = await UploadSession.findById(sessionId);
    if (!session) {
      throw new NotFoundError("Upload session not found", "UPLOAD_NOT_FOUND");
    }

    const storageAccount = await StorageAccount.findById(session.storageAccountId);
    if (!storageAccount) {
      throw new NotFoundError("Storage account not found", "STORAGE_NOT_FOUND");
    }

    await R2Service.putObject(
      storageAccount,
      session.objectKey,
      fileBuffer,
      contentType
    );

    return this.completeUpload(sessionId);
  }


  /**
   * Completes an upload session, commits storage capacity, and queues background video processing
   */
  public static async completeUpload(
    sessionId: string,
    parts?: PartETag[]
  ): Promise<IUploadSession> {
    const session = await UploadSession.findById(sessionId);
    if (!session) {
      throw new NotFoundError("Upload session not found", "UPLOAD_NOT_FOUND");
    }

    const storageAccount = await StorageAccount.findById(session.storageAccountId);
    if (!storageAccount) {
      throw new NotFoundError("Storage account not found", "STORAGE_NOT_FOUND");
    }

    session.status = "COMPLETING";
    await session.save();

    // If multipart, finalize with R2 S3 CompleteMultipartUpload
    if (session.uploadId) {
      if (!parts || parts.length === 0) {
        throw new BadRequestError(
          "Multipart upload requires an array of completed parts ({ PartNumber, ETag })",
          "INVALID_REQUEST"
        );
      }

      try {
        await R2Service.completeMultipartUpload(
          storageAccount,
          session.objectKey,
          session.uploadId,
          parts
        );
      } catch (error: any) {
        session.status = "FAILED";
        session.error = error?.message || "Failed to complete multipart upload on R2";
        await session.save();
        await StorageManagerService.releaseStorage(session.storageAccountId, session.fileSize);
        throw error;
      }
    }

    // Convert reserved storage into usedStorageBytes permanently
    await StorageManagerService.commitStorage(
      session.storageAccountId,
      session.fileSize,
      session.fileSize
    );

    session.status = "UPLOADED";
    session.uploadedBytes = session.fileSize;
    session.progress = 100;
    await session.save();

    // Build public accessible direct URL for the uploaded file
    const basePublicUrl = storageAccount.publicUrl
      ? storageAccount.publicUrl.replace(/\/+$/, "")
      : env.STREAMING_BASE_URL.replace(/\/+$/, "");
    const fileUrl = `${basePublicUrl}/${session.objectKey.replace(/^\/+/, "")}`;

    // Update Movie status and sourceUrl
    if (session.movieId) {
      await Movie.findByIdAndUpdate(session.movieId, {
        status: "PROCESSING",
        sourceUrl: fileUrl,
        processingProgress: 0
      });

      // Enqueue background video processing job in BullMQ (with graceful direct fallback if Redis < 5.0)
      try {
        await videoProcessingQueue.add(
          "process-video",
          {
            movieId: session.movieId.toString(),
            uploadSessionId: session._id.toString(),
            storageAccountId: session.storageAccountId.toString(),
            sourceObjectKey: session.objectKey
          },
          {
            jobId: `proc-${session.movieId.toString()}-${Date.now()}`
          }
        );

        logger.info(
          { movieId: session.movieId, sessionId: session._id, fileUrl },
          "Video processing job successfully enqueued in BullMQ"
        );
      } catch (queueErr: any) {
        logger.warn(
          { err: queueErr?.message },
          "BullMQ enqueue skipped (Redis < 5.0 or stream unsupported). Executing direct background video processing pipeline..."
        );

        // Run direct processing in background without throwing 500 to the client
        ProcessingService.processVideo({
          movieId: session.movieId.toString(),
          uploadSessionId: session._id.toString(),
          storageAccountId: session.storageAccountId.toString(),
          sourceObjectKey: session.objectKey
        }).catch((procErr) => {
          logger.error({ err: procErr?.message }, "Direct background video processing encountered an error");
        });
      }
    }


    return {
      ...session.toObject(),
      fileUrl
    } as any;
  }

  /**
   * Aborts an active upload session and releases reserved storage
   */
  public static async abortUpload(sessionId: string): Promise<IUploadSession> {
    const session = await UploadSession.findById(sessionId);
    if (!session) {
      throw new NotFoundError("Upload session not found", "UPLOAD_NOT_FOUND");
    }

    const storageAccount = await StorageAccount.findById(session.storageAccountId);

    if (storageAccount && session.uploadId) {
      try {
        await R2Service.abortMultipartUpload(storageAccount, session.objectKey, session.uploadId);
      } catch (err) {
        logger.warn({ err }, "Could not abort multipart upload on R2");
      }
    }

    // Release capacity reservation
    await StorageManagerService.releaseStorage(session.storageAccountId, session.fileSize);

    session.status = "ABORTED";
    await session.save();

    if (session.movieId) {
      await Movie.findByIdAndUpdate(session.movieId, { status: "FAILED" });
    }

    logger.info({ sessionId: session._id }, "Upload session aborted and reserved storage released");
    return session;
  }

  /**
   * Gets upload session status
   */
  public static async getById(sessionId: string): Promise<IUploadSession> {
    const session = await UploadSession.findById(sessionId);
    if (!session) {
      throw new NotFoundError("Upload session not found", "UPLOAD_NOT_FOUND");
    }
    return session;
  }
}
