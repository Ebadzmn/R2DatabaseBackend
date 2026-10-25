import fs from "fs/promises";
import os from "os";
import path from "path";
import { FFmpegService } from "../processing/ffmpeg.service";
import { MediaMetadataService } from "../../services/media-metadata.service";
import { Types } from "mongoose";
import { Movie, IMovie, IEpisode } from "./movie.model";
import { StorageAccount } from "../storage/storage.model";
import { R2Service } from "../storage/r2.service";
import { StorageManagerService } from "../../services/storage-manager.service";
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
   * Retrieves all available movie genres with counts
   */
  public static async getGenres() {
    const rawGenres = await Movie.distinct("genres");
    const counts = await Movie.aggregate([
      { $unwind: "$genres" },
      { $group: { _id: "$genres", count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    const countMap: Record<string, number> = {};
    for (const c of counts) {
      if (c._id) countMap[c._id.toString()] = c.count;
    }

    const defaultPopularGenres = [
      "Action", "Comedy", "Thriller", "Horror", "Sci-Fi", 
      "Drama", "Animation", "Romance", "Adventure", "Crime", "Fantasy", "Mystery"
    ];

    const uniqueSet = new Set<string>([
      ...rawGenres.filter(Boolean),
      ...defaultPopularGenres
    ]);

    return Array.from(uniqueSet).map((name) => ({
      name,
      count: countMap[name] || 0
    }));
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

    if (input.description !== undefined) movie.description = input.description ?? undefined;
    if (input.poster !== undefined) movie.poster = input.poster ?? undefined;
    if (input.backdrop !== undefined) movie.backdrop = input.backdrop ?? undefined;
    if (input.type) movie.type = input.type;
    if (input.releaseYear !== undefined) movie.releaseYear = input.releaseYear ?? undefined;
    if (input.genres !== undefined) movie.genres = input.genres ?? [];
    if (input.duration !== undefined) movie.duration = input.duration ?? undefined;
    if (input.rating !== undefined) movie.rating = input.rating ?? undefined;
    if (input.director !== undefined) movie.director = input.director ?? undefined;
    if (input.trailerUrl !== undefined) movie.trailerUrl = input.trailerUrl ?? undefined;
    if (input.tmdbId !== undefined) movie.tmdbId = input.tmdbId ?? undefined;
    if (input.cast !== undefined) movie.cast = input.cast ?? [];
    if (input.totalSeasons !== undefined) movie.totalSeasons = input.totalSeasons ?? 1;
    if (input.episodes !== undefined && input.episodes !== null) movie.episodes = input.episodes;
    if (input.status) movie.status = input.status;
    if (input.screenshots !== undefined) movie.screenshots = input.screenshots ?? [];

    await movie.save();
    return movie;
  }

  public static async addEpisode(
    movieId: string,
    data: {
      seasonNumber: number;
      episodeNumber: number;
      title: string;
      overview?: string;
      stillPath?: string;
      duration?: number;
      airDate?: string;
      rating?: number;
      screenshots?: string[];
    }
  ) {
    const movie = await Movie.findById(movieId);
    if (!movie) {
      throw new NotFoundError("Series not found", "SERIES_NOT_FOUND");
    }

    const newEpisode = {
      _id: new Types.ObjectId(),
      seasonNumber: data.seasonNumber,
      episodeNumber: data.episodeNumber,
      title: data.title,
      overview: data.overview,
      stillPath: data.stillPath,
      duration: data.duration,
      airDate: data.airDate,
      rating: data.rating,
      status: "DRAFT",
      processingProgress: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    movie.episodes.push(newEpisode as any);
    if (data.seasonNumber > (movie.totalSeasons || 1)) {
      movie.totalSeasons = data.seasonNumber;
    }

    await movie.save();
    return newEpisode;
  }

  public static async updateEpisode(
    movieId: string,
    episodeId: string,
    data: Partial<IEpisode>
  ) {
    const movie = await Movie.findById(movieId);
    if (!movie) {
      throw new NotFoundError("Series not found", "SERIES_NOT_FOUND");
    }

    const ep = movie.episodes.find((e) => e._id.toString() === episodeId);
    if (!ep) {
      throw new NotFoundError("Episode not found", "EPISODE_NOT_FOUND");
    }

    if (data.title !== undefined) ep.title = data.title;
    if (data.seasonNumber !== undefined) ep.seasonNumber = data.seasonNumber;
    if (data.episodeNumber !== undefined) ep.episodeNumber = data.episodeNumber;
    if (data.overview !== undefined) ep.overview = data.overview;
    if (data.stillPath !== undefined) ep.stillPath = data.stillPath;
    if (data.duration !== undefined) ep.duration = data.duration;
    if (data.airDate !== undefined) ep.airDate = data.airDate;
    if (data.rating !== undefined) ep.rating = data.rating;
    if (data.screenshots !== undefined) ep.screenshots = data.screenshots;

    await movie.save();
    return ep;
  }

  public static async deleteEpisode(movieId: string, episodeId: string) {
    const movie = await Movie.findById(movieId);
    if (!movie) {
      throw new NotFoundError("Series not found", "SERIES_NOT_FOUND");
    }

    const ep = movie.episodes.find((e) => e._id.toString() === episodeId);
    if (!ep) {
      throw new NotFoundError("Episode not found", "EPISODE_NOT_FOUND");
    }

    // Purge episode files from R2 if uploaded
    if (ep.hlsStorageId || ep.sourceStorageId) {
      const storageId = ep.hlsStorageId || ep.sourceStorageId;
      const hlsPrefix = ep.hlsMasterKey
        ? ep.hlsMasterKey.replace("/master.m3u8", "")
        : `series/${movie.slug}/season-${ep.seasonNumber}/episode-${ep.episodeNumber}/hls`;
      const sourceKey = ep.sourceObjectKey;

      (async () => {
        try {
          const storageAccount = await StorageAccount.findById(storageId);
          if (storageAccount) {
            if (hlsPrefix) await R2Service.deleteDirectory(storageAccount, hlsPrefix);
            if (sourceKey) await R2Service.deleteObject(storageAccount, sourceKey);
            await StorageManagerService.recalculateStorageUsage(storageAccount._id);
          }
        } catch (err) {
          logger.error({ err, episodeId }, "Episode R2 asset purge error");
        }
      })();
    }

    movie.episodes = movie.episodes.filter((e) => e._id.toString() !== episodeId);
    await movie.save();
    return { success: true, message: "Episode removed" };
  }

  public static async importTmdbEpisodes(movieId: string) {
    const movie = await Movie.findById(movieId);
    if (!movie || !movie.tmdbId) {
      throw new BadRequestError("Series does not have a TMDB ID assigned", "INVALID_REQUEST");
    }

    const { tmdbService } = await import("../../services/tmdb.service");
    const details = await tmdbService.getDetails(movie.tmdbId, "tv");
    const seasons = details.seasons || [];

    const existingMap = new Map<string, any>();
    for (const ep of movie.episodes) {
      existingMap.set(`${ep.seasonNumber}-${ep.episodeNumber}`, ep);
    }

    for (const season of seasons) {
      try {
        const seasonData = await tmdbService.getSeasonEpisodes(movie.tmdbId, season.seasonNumber);
        for (const ep of seasonData.episodes) {
          const key = `${season.seasonNumber}-${ep.episodeNumber}`;
          if (!existingMap.has(key)) {
            movie.episodes.push({
              _id: new Types.ObjectId(),
              seasonNumber: season.seasonNumber,
              episodeNumber: ep.episodeNumber,
              title: ep.title || `Episode ${ep.episodeNumber}`,
              overview: ep.overview,
              stillPath: ep.stillPath,
              duration: ep.duration ? ep.duration * 60 : undefined,
              airDate: ep.airDate,
              rating: ep.rating,
              status: "DRAFT",
              processingProgress: 0,
              createdAt: new Date(),
              updatedAt: new Date()
            } as any);
          }
        }
      } catch (err: any) {
        logger.warn({ err: err?.message, seasonNumber: season.seasonNumber }, "Failed to fetch season episodes from TMDB");
      }
    }

    if (details.numberOfSeasons) {
      movie.totalSeasons = details.numberOfSeasons;
    }

    await movie.save();
    return movie;
  }

  public static async getEpisodePlaybackUrl(
    movieId: string,
    seasonNumber: number,
    episodeNumber: number
  ) {
    const movie = await Movie.findById(movieId);
    if (!movie) {
      throw new NotFoundError("Series not found", "SERIES_NOT_FOUND");
    }

    const ep = movie.episodes.find(
      (e) => e.seasonNumber === seasonNumber && e.episodeNumber === episodeNumber
    );

    if (!ep) {
      throw new NotFoundError("Episode not found in series", "EPISODE_NOT_FOUND");
    }

    if (ep.status !== "READY" || !ep.hlsMasterKey) {
      throw new BadRequestError(
        `Episode is not ready for playback (Current status: ${ep.status})`,
        "INVALID_REQUEST"
      );
    }

    let baseUrl = env.STREAMING_BASE_URL.replace(/\/+$/, "");
    if (ep.hlsStorageId) {
      const storageAccount = await StorageAccount.findById(ep.hlsStorageId);
      if (storageAccount?.publicUrl) {
        baseUrl = storageAccount.publicUrl.replace(/\/+$/, "");
      }
    }

    let sourceBaseUrl = baseUrl;
    if (ep.sourceStorageId && ep.sourceStorageId.toString() !== ep.hlsStorageId?.toString()) {
      const srcStorageAccount = await StorageAccount.findById(ep.sourceStorageId);
      if (srcStorageAccount?.publicUrl) {
        sourceBaseUrl = srcStorageAccount.publicUrl.replace(/\/+$/, "");
      }
    }

    const directSourceUrl = ep.sourceObjectKey
      ? `${sourceBaseUrl}/${ep.sourceObjectKey.replace(/^\/+/, "")}`
      : ep.sourceUrl;

    const cleanMasterKey = ep.hlsMasterKey.replace(/^\/+/, "");
    const playbackUrl = `${baseUrl}/${cleanMasterKey}`;
    const proxyUrl = `/api/movies/${movie._id.toString()}/seasons/${seasonNumber}/episodes/${episodeNumber}/stream/master.m3u8`;

    return {
      movieId: movie._id.toString(),
      episodeId: ep._id.toString(),
      seriesTitle: movie.title,
      episodeTitle: ep.title,
      seasonNumber: ep.seasonNumber,
      episodeNumber: ep.episodeNumber,
      type: "HLS",
      url: playbackUrl,
      proxyUrl,
      sourceUrl: directSourceUrl,
      duration: ep.duration
    };
  }

  /**
   * Captures 4 preview screenshots on demand for a movie or episode
   */
  /**
   * Uploads a custom user-provided screenshot to R2 and attaches it to the movie or episode
   */
  public static async uploadCustomScreenshot(
    movieId: string,
    buffer: Buffer,
    originalName: string,
    mimeType: string,
    seasonNumber?: number,
    episodeNumber?: number
  ): Promise<{ url: string; screenshots: string[] }> {
    const movie = await Movie.findById(movieId);
    if (!movie) {
      throw new NotFoundError("Movie not found", "MOVIE_NOT_FOUND");
    }

    const isEpisode = seasonNumber !== undefined && episodeNumber !== undefined;
    let ep: IEpisode | undefined;
    if (isEpisode) {
      ep = movie.episodes.find(
        (e) => e.seasonNumber === seasonNumber && e.episodeNumber === episodeNumber
      );
      if (!ep) {
        throw new NotFoundError("Episode not found in series", "EPISODE_NOT_FOUND");
      }
    }

    const storageId = (isEpisode ? ep?.hlsStorageId || ep?.sourceStorageId : null) || movie.hlsStorageId || movie.sourceStorageId;
    let storageAccount: any = storageId ? await StorageAccount.findById(storageId) : null;
    if (!storageAccount) {
      storageAccount = await StorageManagerService.selectStorage(buffer.length);
    }

    let ext = ".jpg";
    if (mimeType.includes("png") || originalName.endsWith(".png")) ext = ".png";
    else if (mimeType.includes("webp") || originalName.endsWith(".webp")) ext = ".webp";

    const cleanBaseName = slugify(path.parse(originalName).name) || "screenshot";
    const filename = `manual_${Date.now()}_${cleanBaseName}${ext}`;

    let key = `movies/${movie.slug}/${movie._id.toString()}/screenshots/${filename}`;
    if (isEpisode) {
      key = `series/${movie.slug}/season-${seasonNumber}/episode-${episodeNumber}/screenshots/${filename}`;
    }

    await R2Service.putObject(storageAccount, key, buffer, mimeType);

    await StorageAccount.findByIdAndUpdate(storageAccount._id, {
      $inc: { usedStorageBytes: buffer.length }
    });

    const cdnBase = (storageAccount.publicUrl || env.STREAMING_BASE_URL || "").replace(/\/+$/, "");
    const proxyPath = isEpisode
      ? `/api/movies/${movie._id.toString()}/seasons/${seasonNumber}/episodes/${episodeNumber}/screenshots/${filename}`
      : `/api/movies/${movie._id.toString()}/screenshots/${filename}`;
    const finalUrl = cdnBase ? `${cdnBase}/${key}` : proxyPath;

    if (isEpisode && ep) {
      ep.screenshots = [...(ep.screenshots || []), finalUrl];
      if (!ep.stillPath) ep.stillPath = finalUrl;
      await movie.save();
      return { url: finalUrl, screenshots: ep.screenshots };
    } else {
      movie.screenshots = [...(movie.screenshots || []), finalUrl];
      if (!movie.backdrop) movie.backdrop = finalUrl;
      if (!movie.poster) movie.poster = finalUrl;
      await movie.save();
      return { url: finalUrl, screenshots: movie.screenshots };
    }
  }

  /**
   * Uploads any general image to R2 (used for poster, backdrop, or new movie creation)
   */
  public static async uploadGeneralImage(
    buffer: Buffer,
    originalName: string,
    mimeType: string
  ): Promise<{ url: string; key: string }> {
    const storageAccount = await StorageManagerService.selectStorage(buffer.length);

    let ext = ".jpg";
    if (mimeType.includes("png") || originalName.endsWith(".png")) ext = ".png";
    else if (mimeType.includes("webp") || originalName.endsWith(".webp")) ext = ".webp";

    const cleanBaseName = slugify(path.parse(originalName).name) || "image";
    const filename = `custom_${Date.now()}_${cleanBaseName}${ext}`;
    const key = `uploads/images/${filename}`;

    await R2Service.putObject(storageAccount, key, buffer, mimeType);

    await StorageAccount.findByIdAndUpdate(storageAccount._id, {
      $inc: { usedStorageBytes: buffer.length }
    });

    const cdnBase = (storageAccount.publicUrl || env.STREAMING_BASE_URL || "").replace(/\/+$/, "");
    const url = cdnBase ? `${cdnBase}/${key}` : `/uploads/images/${filename}`;

    return { url, key };
  }

  public static async captureScreenshots(
    movieId: string,
    seasonNumber?: number,
    episodeNumber?: number
  ): Promise<string[]> {
    const movie = await Movie.findById(movieId);
    if (!movie) {
      throw new NotFoundError("Movie not found", "MOVIE_NOT_FOUND");
    }

    const isEpisode = seasonNumber !== undefined && episodeNumber !== undefined;
    let ep: IEpisode | undefined;
    if (isEpisode) {
      ep = movie.episodes.find(
        (e) => e.seasonNumber === seasonNumber && e.episodeNumber === episodeNumber
      );
      if (!ep) {
        throw new NotFoundError("Episode not found in series", "EPISODE_NOT_FOUND");
      }
    }

    const storageId = (isEpisode ? ep?.hlsStorageId || ep?.sourceStorageId : null) || movie.hlsStorageId || movie.sourceStorageId;
    if (!storageId) {
      throw new BadRequestError("Movie does not have an associated storage account", "INVALID_REQUEST");
    }

    const storageAccount = await StorageAccount.findById(storageId);
    if (!storageAccount) {
      throw new NotFoundError("Storage account not found", "STORAGE_NOT_FOUND");
    }

    // Determine source input key or stream
    const sourceKey = (isEpisode ? ep?.sourceObjectKey : null) || movie.sourceObjectKey;
    const hlsKey = (isEpisode ? ep?.hlsMasterKey : null) || movie.hlsMasterKey;

    let sourceInput = "";
    if (storageAccount.publicUrl && sourceKey) {
      const cleanBase = storageAccount.publicUrl.replace(/\/+$/, "");
      const cleanKey = sourceKey.replace(/^\/+/, "");
      sourceInput = `${cleanBase}/${cleanKey}`;
    } else if (sourceKey) {
      sourceInput = await R2Service.getPresignedGetUrl(storageAccount, sourceKey, 3600);
    } else if (storageAccount.publicUrl && hlsKey) {
      const cleanBase = storageAccount.publicUrl.replace(/\/+$/, "");
      const cleanKey = hlsKey.replace(/^\/+/, "");
      sourceInput = `${cleanBase}/${cleanKey}`;
    } else if (hlsKey) {
      sourceInput = await R2Service.getPresignedGetUrl(storageAccount, hlsKey, 3600);
    }

    if (!sourceInput) {
      throw new BadRequestError("No valid video source found to extract screenshots from", "INVALID_REQUEST");
    }

    let duration = (isEpisode ? ep?.duration : movie.duration) || 0;
    if (duration <= 0) {
      try {
        const probe = await MediaMetadataService.probe(sourceInput);
        duration = probe.duration || 60;
      } catch (e) {
        duration = 60;
      }
    }

    const tempDir = path.join(os.tmpdir(), `capt-ss-${movieId}-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    try {
      const captured = await FFmpegService.generateScreenshots(sourceInput, tempDir, duration, 4);

      let screenshotsPrefix = `movies/${movie.slug}/${movie._id.toString()}/screenshots`;
      if (isEpisode) {
        screenshotsPrefix = `series/${movie.slug}/season-${seasonNumber}/episode-${episodeNumber}/screenshots`;
      }

      await ProcessingService.uploadDirectoryToR2(storageAccount, tempDir, screenshotsPrefix);

      const cdnBase = (storageAccount.publicUrl || env.STREAMING_BASE_URL || "").replace(/\/+$/, "");
      const screenshotUrls: string[] = [];

      for (let i = 1; i <= captured.length; i++) {
        const key = `${screenshotsPrefix}/screenshot_${i}.jpg`;
        const proxyPath = isEpisode
          ? `/api/movies/${movie._id.toString()}/seasons/${seasonNumber}/episodes/${episodeNumber}/screenshots/screenshot_${i}.jpg`
          : `/api/movies/${movie._id.toString()}/screenshots/screenshot_${i}.jpg`;
        screenshotUrls.push(cdnBase ? `${cdnBase}/${key}` : proxyPath);
      }

      if (isEpisode && ep) {
        ep.screenshots = screenshotUrls;
        if (!ep.stillPath && screenshotUrls.length > 0) {
          ep.stillPath = screenshotUrls[0];
        }
      } else {
        movie.screenshots = screenshotUrls;
        if (!movie.backdrop && screenshotUrls.length > 0) {
          movie.backdrop = screenshotUrls[0];
        }
        if (!movie.poster && screenshotUrls.length > 0) {
          movie.poster = screenshotUrls[0];
        }
      }

      await movie.save();
      return screenshotUrls;
    } finally {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (e) {}
    }
  }

  public static async delete(id: string): Promise<void> {
    const movie = await Movie.findById(id);
    if (!movie) {
      throw new NotFoundError("Movie not found", "MOVIE_NOT_FOUND");
    }

    const storageId = movie.hlsStorageId || movie.sourceStorageId;
    const hlsPrefix = movie.hlsMasterKey
      ? movie.hlsMasterKey.replace("/master.m3u8", "")
      : movie.type === "SERIES"
      ? `series/${movie.slug}`
      : `movies/${movie.slug}/${movie._id.toString()}/hls`;
    const sourceKey = movie.sourceObjectKey;

    // Immediately remove MongoDB document so UI responds instantly
    await Movie.findByIdAndDelete(id);

    if (storageId) {
      // 1. Dispatch BullMQ delete queue
      movieDeleteQueue
        .add(
          "delete-movie-assets",
          {
            movieId: id,
            storageAccountId: storageId.toString(),
            hlsPrefix,
            sourceKey
          },
          {
            jobId: `del-${id}-${Date.now()}`
          }
        )
        .catch((queueErr: any) => {
          logger.warn(
            { err: queueErr?.message },
            "movieDeleteQueue enqueue failed. Running direct background deletion..."
          );
        });

      // 2. Direct background deletion guarantee for R2
      (async () => {
        try {
          const storageAccount = await StorageAccount.findById(storageId);
          if (storageAccount) {
            if (hlsPrefix) {
              await R2Service.deleteDirectory(storageAccount, hlsPrefix);
            }
            if (sourceKey) {
              await R2Service.deleteObject(storageAccount, sourceKey);
            }
            // Real-time synchronization of R2 storage bytes
            await StorageManagerService.recalculateStorageUsage(storageAccount._id);
          }
        } catch (err: any) {
          logger.error({ err: err?.message, movieId: id }, "Direct R2 movie asset purge error");
        }
      })();
    }

    logger.info({ movieId: id }, "Movie and R2 asset cleanup completed successfully");
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

    // Direct execution
    ProcessingService.processVideo({
      movieId: movie._id.toString(),
      uploadSessionId: "",
      storageAccountId: movie.sourceStorageId.toString(),
      sourceObjectKey: movie.sourceObjectKey
    }).catch((procErr) => {
      logger.error({ err: procErr?.message, movieId: movie._id }, "Direct background video processing failed");
    });

    videoProcessingQueue
      .add(
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
      )
      .catch(() => {});

    return { message: "Movie video processing immediately started" };
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
