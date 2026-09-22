import { Movie, IMovie } from "./movie.model";
import { StorageAccount } from "../storage/storage.model";
import { R2Service } from "../storage/r2.service";
import { videoProcessingQueue, movieDeleteQueue } from "../processing/processing.queue";
import { ProcessingService } from "../processing/processing.service";
import { CreateMovieInput, UpdateMovieInput, QueryMoviesInput } from "./movie.validation";
import { slugify } from "../../utils/slugify";
import { env } from "../../config/env";
import { NotFoundError, BadRequestError } from "../../utils/errors";
import { logger } from "../../utils/logger";

export class MovieService {
  /**
   * Lists movies with pagination, search, filters, and sorting
   */
  public static async getAll(query: QueryMoviesInput) {
    const filter: Record<string, unknown> = {};

    if (query.status) {
      filter.status = query.status;
    }

    if (query.genre) {
      filter.genres = { $regex: new RegExp(query.genre, "i") };
    }

    if (query.year) {
      filter.releaseYear = query.year;
    }

    if (query.search) {
      filter.$text = { $search: query.search };
    }

    const sortOrder = query.sortOrder === "asc" ? 1 : -1;
    const sort: Record<string, 1 | -1> = { [query.sortBy]: sortOrder };

    const page = Math.max(1, query.page);
    const limit = Math.max(1, Math.min(100, query.limit));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      Movie.find(filter)
        .populate("sourceStorageId", "name bucketName")
        .populate("hlsStorageId", "name bucketName")
        .sort(sort)
        .skip(skip)
        .limit(limit),
      Movie.countDocuments(filter)
    ]);

    return {
      items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Retrieves a single movie by ID
   */
  public static async getById(id: string): Promise<IMovie> {
    const movie = await Movie.findById(id)
      .populate("sourceStorageId", "name bucketName")
      .populate("hlsStorageId", "name bucketName");

    if (!movie) {
      throw new NotFoundError("Movie not found", "MOVIE_NOT_FOUND");
    }

    return movie;
  }

  /**
   * Creates a new movie record in DRAFT status
   */
  public static async create(input: CreateMovieInput): Promise<IMovie> {
    const baseSlug = slugify(input.title);
    const uniqueSlug = `${baseSlug}-${Date.now().toString().slice(-4)}`;

    const movie = await Movie.create({
      ...input,
      slug: uniqueSlug,
      status: "DRAFT"
    });

    return movie;
  }

  /**
   * Updates an existing movie
   */
  public static async update(id: string, input: UpdateMovieInput): Promise<IMovie> {
    const movie = await Movie.findById(id);
    if (!movie) {
      throw new NotFoundError("Movie not found", "MOVIE_NOT_FOUND");
    }

    if (input.title && input.title !== movie.title) {
      movie.title = input.title;
      movie.slug = `${slugify(input.title)}-${Date.now().toString().slice(-4)}`;
    }

    if (input.description !== undefined) movie.description = input.description;
    if (input.poster !== undefined) movie.poster = input.poster;
    if (input.backdrop !== undefined) movie.backdrop = input.backdrop;
    if (input.type) movie.type = input.type;
    if (input.releaseYear !== undefined) movie.releaseYear = input.releaseYear;
    if (input.genres) movie.genres = input.genres;
    if (input.status) movie.status = input.status;

    await movie.save();
    return movie;
  }

  /**
   * Deletes a movie, dispatching background cleanup for R2 HLS segments and source files
   */
  public static async delete(id: string): Promise<void> {
    const movie = await Movie.findById(id);
    if (!movie) {
      throw new NotFoundError("Movie not found", "MOVIE_NOT_FOUND");
    }

    const storageId = movie.hlsStorageId || movie.sourceStorageId;
    const hlsPrefix = movie.hlsMasterKey
      ? movie.hlsMasterKey.replace("/master.m3u8", "")
      : `movies/${movie.slug}/${movie._id.toString()}/hls`;

    if (storageId) {
      // Queue background job for deleting R2 objects and releasing storage (with graceful fallback if Redis < 5.0)
      try {
        await movieDeleteQueue.add(
          "delete-movie-assets",
          {
            movieId: movie._id.toString(),
            storageAccountId: storageId.toString(),
            hlsPrefix,
            sourceKey: movie.sourceObjectKey
          },
          {
            jobId: `del-${movie._id.toString()}-${Date.now()}`
          }
        );
      } catch (queueErr: any) {
        logger.warn(
          { err: queueErr?.message },
          "movieDeleteQueue enqueue failed (Redis < 5.0). Running direct background deletion..."
        );

        // Perform direct deletion
        (async () => {
          try {
            const storageAccount = await StorageAccount.findById(storageId);
            if (storageAccount) {
              if (hlsPrefix) {
                await R2Service.deleteDirectory(storageAccount, hlsPrefix);
              }
              if (movie.sourceObjectKey) {
                await R2Service.deleteObject(storageAccount, movie.sourceObjectKey);
              }
            }
            await Movie.findByIdAndDelete(id);
          } catch (err: any) {
            logger.error({ err: err?.message }, "Direct movie deletion error");
            await Movie.findByIdAndDelete(id);
          }
        })();
      }
    } else {
      await Movie.findByIdAndDelete(id);
    }

    logger.info({ movieId: id }, "Movie deletion initiated successfully");
  }

  /**
   * Triggers or re-triggers video processing for a movie
   */
  public static async process(id: string): Promise<{ message: string }> {
    const movie = await Movie.findById(id);
    if (!movie) {
      throw new NotFoundError("Movie not found", "MOVIE_NOT_FOUND");
    }

    if (!movie.sourceObjectKey || !movie.sourceStorageId) {
      throw new BadRequestError(
        "Cannot process movie: source video has not been uploaded yet",
        "INVALID_REQUEST"
      );
    }

    movie.status = "PROCESSING";
    movie.processingProgress = 0;
    movie.processingError = undefined;
    await movie.save();

    try {
      await videoProcessingQueue.add(
        "process-video",
        {
          movieId: movie._id.toString(),
          uploadSessionId: "",
          storageAccountId: movie.sourceStorageId.toString(),
          sourceObjectKey: movie.sourceObjectKey
        },
        {
          jobId: `proc-${movie._id.toString()}-${Date.now()}`
        }
      );
    } catch (queueErr: any) {
      logger.warn(
        { err: queueErr?.message },
        "BullMQ enqueue failed (Redis < 5.0 or offline). Executing direct background video processing pipeline..."
      );

      ProcessingService.processVideo({
        movieId: movie._id.toString(),
        uploadSessionId: "",
        storageAccountId: movie.sourceStorageId.toString(),
        sourceObjectKey: movie.sourceObjectKey
      }).catch((procErr) => {
        logger.error({ err: procErr?.message }, "Direct background video processing failed");
      });
    }

    return { message: "Movie processing queued successfully" };
  }


  /**
   * Retrieves current processing status and progress
   */
  public static async getStatus(id: string) {
    const movie = await Movie.findById(id).select(
      "status processingProgress processingError duration resolution videoCodec audioCodec"
    );

    if (!movie) {
      throw new NotFoundError("Movie not found", "MOVIE_NOT_FOUND");
    }

    return {
      status: movie.status,
      progress: movie.processingProgress || 0,
      error: movie.processingError,
      metadata: {
        duration: movie.duration,
        resolution: movie.resolution,
        videoCodec: movie.videoCodec,
        audioCodec: movie.audioCodec
      }
    };
  }

  /**
   * Generates public playback URL for the Flutter client
   */
  public static async getPlaybackUrl(id: string): Promise<{
    movieId: string;
    title: string;
    type: "HLS";
    url: string;
    proxyUrl?: string;
    sourceUrl?: string;
    duration?: number;
  }> {
    const movie = await Movie.findById(id);
    if (!movie) {
      throw new NotFoundError("Movie not found", "MOVIE_NOT_FOUND");
    }

    if (movie.status !== "READY" || !movie.hlsMasterKey) {
      throw new BadRequestError(
        `Movie is not ready for playback (Current status: ${movie.status})`,
        "INVALID_REQUEST"
      );
    }

    // Determine public base URL from storage account or environment
    let baseUrl = env.STREAMING_BASE_URL.replace(/\/+$/, "");
    if (movie.hlsStorageId) {
      const storageAccount = await StorageAccount.findById(movie.hlsStorageId);
      if (storageAccount?.publicUrl) {
        baseUrl = storageAccount.publicUrl.replace(/\/+$/, "");
      }
    }

    const cleanMasterKey = movie.hlsMasterKey.replace(/^\/+/, "");
    const playbackUrl = `${baseUrl}/${cleanMasterKey}`;
    const proxyUrl = `/api/movies/${movie._id.toString()}/stream/master.m3u8`;
    const directSourceUrl = movie.sourceObjectKey
      ? `${baseUrl}/${movie.sourceObjectKey.replace(/^\/+/, "")}`
      : movie.sourceUrl;

    return {
      movieId: movie._id.toString(),
      title: movie.title,
      type: "HLS",
      url: playbackUrl,
      proxyUrl,
      sourceUrl: directSourceUrl,
      duration: movie.duration
    };
  }
}
