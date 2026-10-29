import { Types } from "mongoose";
import { WatchHistory, IWatchHistory, PlaybackAction, PlaybackStatus } from "./playback.model";
import { Movie } from "../movies/movie.model";
import { NotFoundError, BadRequestError } from "../../utils/errors";

export interface RecordProgressInput {
  movieId: string;
  positionSeconds: number;
  durationSeconds: number;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  episodeId?: string | null;
  episodeTitle?: string | null;
  action?: PlaybackAction;
}

export interface WatchHistoryQueryOptions {
  page?: number;
  limit?: number;
  status?: string;
}

export class PlaybackService {
  // Configurable completion threshold (90% watched or remaining <= 30s)
  private static readonly COMPLETION_THRESHOLD_PERCENT = 90.0;
  private static readonly COMPLETION_REMAINING_SECONDS = 30.0;

  /**
   * Records or updates playback progress for a movie or series episode
   * Automatically calculates progress percentage and completion status
   */
  public static async recordProgress(
    userId: string | Types.ObjectId,
    input: RecordProgressInput
  ): Promise<IWatchHistory> {
    const userObjectId = typeof userId === "string" ? new Types.ObjectId(userId) : userId;

    // Resolve movie by ObjectId or slug
    let movie = null;
    if (Types.ObjectId.isValid(input.movieId)) {
      movie = await Movie.findById(input.movieId);
    }
    if (!movie) {
      movie = await Movie.findOne({ slug: input.movieId.toLowerCase() });
    }

    if (!movie) {
      throw new NotFoundError(`Movie or Series not found: ${input.movieId}`);
    }

    const movieObjectId = movie._id;
    const isSeries = movie.type === "SERIES";

    let seasonNum = isSeries ? (input.seasonNumber ?? 1) : null;
    let episodeNum = isSeries ? (input.episodeNumber ?? 1) : null;
    let epTitle = input.episodeTitle;
    let epId = input.episodeId ? new Types.ObjectId(input.episodeId) : null;

    // Parse and sanitize numeric inputs
    const pos = Number.isFinite(Number(input.positionSeconds))
      ? Math.max(0, Number(input.positionSeconds))
      : 0;
    const durInput = Number.isFinite(Number(input.durationSeconds))
      ? Math.max(0, Number(input.durationSeconds))
      : 0;

    // Resolve true movie/series duration: player's exact duration has top priority
    let totalDuration = 0;
    if (durInput > 0) {
      totalDuration = durInput;
    } else if (movie.duration && movie.duration > 0) {
      totalDuration = movie.duration;
    }

    // If series, attempt to find episode details for title & duration
    if (isSeries && movie.episodes && movie.episodes.length > 0) {
      const episode = movie.episodes.find(
        (ep) => ep.seasonNumber === seasonNum && ep.episodeNumber === episodeNum
      );
      if (episode) {
        if (!epTitle) epTitle = episode.title;
        if (!epId) epId = episode._id;
        if (totalDuration <= 0 && episode.duration && episode.duration > 0) {
          totalDuration = episode.duration;
        }
      }
    }

    if (totalDuration <= 0) {
      totalDuration = isSeries ? 2700 : 7200;
    }

    const progressPercentage =
      totalDuration > 0
        ? Math.min(100.0, Math.max(0.0, (pos / totalDuration) * 100.0))
        : 0.0;

    // Determine completion status
    let status: PlaybackStatus = "IN_PROGRESS";
    const isExplicitlyCompleted = input.action === "COMPLETED";
    const reachedPercentageThreshold = progressPercentage >= this.COMPLETION_THRESHOLD_PERCENT;
    const reachedTimeThreshold =
      totalDuration > 0 && totalDuration - pos <= this.COMPLETION_REMAINING_SECONDS;

    if (isExplicitlyCompleted || reachedPercentageThreshold || reachedTimeThreshold) {
      status = "COMPLETED";
    } else if (pos < 5) {
      status = "NOT_COMPLETED";
    } else {
      status = "IN_PROGRESS";
    }

    // Query filter for unique composite key
    const filter: Record<string, any> = {
      userId: userObjectId,
      movieId: movieObjectId,
      seasonNumber: seasonNum,
      episodeNumber: episodeNum
    };

    const updateDoc = {
      userId: userObjectId,
      movieId: movieObjectId,
      movieType: movie.type,
      seasonNumber: seasonNum,
      episodeNumber: episodeNum,
      episodeId: epId,
      episodeTitle: epTitle || (isSeries ? `Episode ${episodeNum}` : undefined),
      positionSeconds: pos,
      durationSeconds: totalDuration,
      progressPercentage: Math.round(progressPercentage * 10) / 10,
      status,
      lastAction: input.action || "HEARTBEAT",
      lastWatchedAt: new Date(),
      title: movie.title,
      poster: movie.poster,
      backdrop: movie.backdrop,
      genres: movie.genres
    };

    const record = await WatchHistory.findOneAndUpdate(
      filter,
      { $set: updateDoc },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return record;
  }

  /**
   * Retrieves playback progress for a specific movie or series episode
   */
  public static async getProgress(
    userId: string | Types.ObjectId,
    movieId: string,
    seasonNumber?: number,
    episodeNumber?: number
  ): Promise<IWatchHistory | null> {
    const userObjectId = typeof userId === "string" ? new Types.ObjectId(userId) : userId;

    let movie = null;
    if (Types.ObjectId.isValid(movieId)) {
      movie = await Movie.findById(movieId);
    }
    if (!movie) {
      movie = await Movie.findOne({ slug: movieId.toLowerCase() });
    }

    if (!movie) return null;

    const filter: Record<string, any> = {
      userId: userObjectId,
      movieId: movie._id
    };

    if (movie.type === "SERIES") {
      if (seasonNumber !== undefined) filter.seasonNumber = seasonNumber;
      if (episodeNumber !== undefined) filter.episodeNumber = episodeNumber;
    } else {
      filter.seasonNumber = null;
      filter.episodeNumber = null;
    }

    // If series without specific episode requested, get the most recently watched episode
    return WatchHistory.findOne(filter).sort({ lastWatchedAt: -1 });
  }

  /**
   * Retrieves all items currently "IN_PROGRESS" for the Continue Watching section
   */
  public static async getContinueWatching(
    userId: string | Types.ObjectId,
    limit: number = 20
  ): Promise<any[]> {
    const userObjectId = typeof userId === "string" ? new Types.ObjectId(userId) : userId;

    const historyItems = await WatchHistory.find({
      userId: userObjectId,
      status: "IN_PROGRESS",
      progressPercentage: { $gte: 1 }
    })
      .sort({ lastWatchedAt: -1 })
      .limit(limit)
      .populate("movieId", "title slug poster backdrop type resolution audioCodec videoCodec duration episodes");

    return historyItems.map((item) => this.formatContinueWatchingItem(item));
  }

  /**
   * Formats a WatchHistory document for the Continue Watching UI
   */
  private static formatContinueWatchingItem(item: IWatchHistory): any {
    const movie: any = item.movieId || {};
    const pos = Math.max(0, item.positionSeconds);
    let dur = item.durationSeconds > 0 ? item.durationSeconds : 0;
    if (dur <= 0 && item.movieType === "SERIES" && Array.isArray(movie.episodes) && movie.episodes.length > 0) {
      const ep = movie.episodes.find(
        (e: any) => e.seasonNumber === (item.seasonNumber ?? 1) && e.episodeNumber === (item.episodeNumber ?? 1)
      );
      if (ep && ep.duration > 0) dur = ep.duration;
    }
    if (dur <= 0 && movie.duration > 0) {
      dur = movie.duration;
    }
    if (dur <= 0) {
      dur = item.movieType === "SERIES" ? 2700 : 7200;
    }
    const remainingSec = Math.max(0, dur - pos);

    let remainingTime = "";
    if (remainingSec <= 0 || item.status === "COMPLETED") {
      remainingTime = "Completed";
    } else if (remainingSec < 60) {
      remainingTime = `${Math.ceil(remainingSec)}s left`;
    } else if (remainingSec < 3600) {
      const mins = Math.floor(remainingSec / 60);
      const secs = Math.ceil(remainingSec % 60);
      remainingTime = (mins < 5 && secs > 0) ? `${mins}m ${secs}s left` : `${Math.ceil(remainingSec / 60)}m left`;
    } else {
      const hours = Math.floor(remainingSec / 3600);
      const mins = Math.ceil((remainingSec % 3600) / 60);
      remainingTime = mins > 0 ? `${hours}h ${mins}m left` : `${hours}h left`;
    }

    let episodeInfo = "Movie";
    if (item.movieType === "SERIES") {
      const s = item.seasonNumber ?? 1;
      const e = item.episodeNumber ?? 1;
      episodeInfo = `S${s} : E${e}${item.episodeTitle ? ` • ${item.episodeTitle}` : ""}`;
    } else {
      let elapsedStr = "";
      if (pos < 60) {
        elapsedStr = `${Math.floor(pos)}s elapsed`;
      } else if (pos < 3600) {
        elapsedStr = `${Math.floor(pos / 60)}m elapsed`;
      } else {
        const h = Math.floor(pos / 3600);
        const m = Math.floor((pos % 3600) / 60);
        elapsedStr = `${h}h ${m}m elapsed`;
      }
      episodeInfo = `Movie • ${elapsedStr}`;
    }

    const progressRatio = dur > 0
      ? Math.min(1.0, Math.max(0.0, pos / dur))
      : 0.0;

    return {
      id: item._id.toString(),
      movieId: movie._id ? movie._id.toString() : (item.movieId ? item.movieId.toString() : ""),
      movieSlug: movie.slug || undefined,
      movieType: item.movieType,
      title: item.title || movie.title || "Untitled",
      episodeInfo,
      remainingTime,
      qualityInfo: movie.resolution || "4K UHD",
      audioInfo: movie.audioCodec || "Dolby Atmos",
      imageUrl: item.backdrop || item.poster || movie.backdrop || movie.poster || "",
      progress: Math.round(progressRatio * 100) / 100,
      progressPercentage: item.progressPercentage,
      positionSeconds: item.positionSeconds,
      durationSeconds: dur,
      seasonNumber: item.seasonNumber,
      episodeNumber: item.episodeNumber,
      episodeTitle: item.episodeTitle,
      status: item.status,
      lastWatchedAt: item.lastWatchedAt
    };
  }

  /**
   * Retrieves full watch history list with filtering and pagination
   */
  public static async getWatchHistory(
    userId: string | Types.ObjectId,
    options: WatchHistoryQueryOptions = {}
  ): Promise<{
    items: any[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const userObjectId = typeof userId === "string" ? new Types.ObjectId(userId) : userId;
    const page = Math.max(1, options.page || 1);
    const limit = Math.min(100, Math.max(1, options.limit || 20));
    const skip = (page - 1) * limit;

    const filter: Record<string, any> = { userId: userObjectId };
    if (options.status && options.status !== "ALL") {
      filter.status = options.status;
    }

    const [items, total] = await Promise.all([
      WatchHistory.find(filter)
        .sort({ lastWatchedAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("movieId", "title slug poster backdrop type releaseYear resolution rating duration episodes"),
      WatchHistory.countDocuments(filter)
    ]);

    const formatted = items.map((item) => {
      const movie: any = item.movieId || {};
      const pos = Math.max(0, item.positionSeconds);
      let dur = item.durationSeconds > 0 ? item.durationSeconds : 0;
      if (dur <= 0 && item.movieType === "SERIES" && Array.isArray(movie.episodes) && movie.episodes.length > 0) {
        const ep = movie.episodes.find(
          (e: any) => e.seasonNumber === (item.seasonNumber ?? 1) && e.episodeNumber === (item.episodeNumber ?? 1)
        );
        if (ep && ep.duration > 0) dur = ep.duration;
      }
      if (dur <= 0 && movie.duration > 0) {
        dur = movie.duration;
      }
      if (dur <= 0) {
        dur = item.movieType === "SERIES" ? 2700 : 7200;
      }
      const progressRatio = dur > 0
        ? Math.min(1.0, Math.max(0.0, pos / dur))
        : 0.0;

      return {
        id: item._id.toString(),
        movieId: movie._id ? movie._id.toString() : (item.movieId ? item.movieId.toString() : ""),
        movieSlug: movie.slug || undefined,
        movieType: item.movieType,
        title: item.title || movie.title || "Untitled",
        seasonNumber: item.seasonNumber,
        episodeNumber: item.episodeNumber,
        episodeTitle: item.episodeTitle,
        positionSeconds: item.positionSeconds,
        durationSeconds: dur,
        progress: Math.round(progressRatio * 100) / 100,
        progressPercentage: item.progressPercentage,
        status: item.status,
        lastAction: item.lastAction,
        lastWatchedAt: item.lastWatchedAt,
        poster: item.poster || movie.poster || "",
        backdrop: item.backdrop || movie.backdrop || "",
        releaseYear: movie.releaseYear || undefined,
        rating: movie.rating || undefined,
        genres: item.genres || movie.genres || []
      };
    });

    return {
      items: formatted,
      total,
      page,
      totalPages: Math.ceil(total / limit)
    };
  }

  /**
   * Deletes a single history record by ID
   */
  public static async removeHistoryItem(
    userId: string | Types.ObjectId,
    historyId: string
  ): Promise<boolean> {
    const userObjectId = typeof userId === "string" ? new Types.ObjectId(userId) : userId;
    
    // Check if historyId is ObjectId or movieId
    let query: Record<string, any> = { userId: userObjectId };
    if (Types.ObjectId.isValid(historyId)) {
      query.$or = [{ _id: new Types.ObjectId(historyId) }, { movieId: new Types.ObjectId(historyId) }];
    } else {
      query._id = historyId;
    }

    const result = await WatchHistory.deleteOne(query);
    return (result.deletedCount ?? 0) > 0;
  }

  /**
   * Clears all watch history for a user
   */
  public static async clearAllHistory(
    userId: string | Types.ObjectId
  ): Promise<number> {
    const userObjectId = typeof userId === "string" ? new Types.ObjectId(userId) : userId;
    const result = await WatchHistory.deleteMany({ userId: userObjectId });
    return result.deletedCount ?? 0;
  }

  /**
   * Retrieves playback progress summary for all watched titles for quick client-side card hydration
   */
  public static async getPlaybackSummary(
    userId: string | Types.ObjectId
  ): Promise<Record<string, any>> {
    const userObjectId = typeof userId === "string" ? new Types.ObjectId(userId) : userId;

    const histories = await WatchHistory.find({ userId: userObjectId })
      .sort({ lastWatchedAt: -1 })
      .populate("movieId", "title slug type totalSeasons episodes duration");

    const summaryMap: Record<string, any> = {};

    // Group by movieId
    const grouped = new Map<string, IWatchHistory[]>();
    for (const h of histories) {
      if (!h.movieId) continue;
      const mId = (h.movieId as any)?._id
        ? (h.movieId as any)._id.toString()
        : (h.movieId ? h.movieId.toString() : "");
      if (!mId) continue;
      if (!grouped.has(mId)) {
        grouped.set(mId, []);
      }
      grouped.get(mId)!.push(h);
    }

    for (const [mId, items] of grouped.entries()) {
      const latest = items[0];
      const movieDoc: any = latest.movieId && (latest.movieId as any).title ? latest.movieId : null;
      const isSeries = (movieDoc?.type || latest.movieType) === "SERIES";

      let progressRatio = 0.0;
      let isCompleted = latest.status === "COMPLETED";
      let status = latest.status;
      let remainingTime = "";

      const pos = Math.max(0, latest.positionSeconds);
      let effectiveDuration = latest.durationSeconds > 0 ? latest.durationSeconds : 0;
      if (effectiveDuration <= 0 && isSeries && Array.isArray(movieDoc?.episodes) && movieDoc.episodes.length > 0) {
        const ep = movieDoc.episodes.find(
          (e: any) => e.seasonNumber === (latest.seasonNumber || 1) && e.episodeNumber === (latest.episodeNumber || 1)
        );
        if (ep && ep.duration > 0) effectiveDuration = ep.duration;
      }
      if (effectiveDuration <= 0 && movieDoc?.duration > 0) {
        effectiveDuration = movieDoc.duration;
      }
      if (effectiveDuration <= 0) {
        effectiveDuration = isSeries ? 2700 : 7200;
      }

      if (isSeries && movieDoc) {
        const totalEpisodes = movieDoc.episodes?.length || movieDoc.totalEpisodes || items.length || 1;
        const completedEpisodes = items.filter((h) => h.status === "COMPLETED").length;
        const latestEpRatio = effectiveDuration > 0
          ? Math.min(1.0, latest.positionSeconds / effectiveDuration)
          : 0.0;

        if (completedEpisodes >= totalEpisodes && totalEpisodes > 0) {
          progressRatio = 1.0;
          isCompleted = true;
          status = "COMPLETED";
          remainingTime = "Completed";
        } else {
          progressRatio = Math.min(1.0, (completedEpisodes + (latest.status === "COMPLETED" ? 0 : latestEpRatio)) / Math.max(totalEpisodes, items.length));
          if (progressRatio >= 0.9) {
            progressRatio = 1.0;
            isCompleted = true;
            status = "COMPLETED";
            remainingTime = "Completed";
          } else {
            status = "IN_PROGRESS";
            const remainingSec = Math.max(0, effectiveDuration - latest.positionSeconds);
            let remainingFormatted = "";
            if (remainingSec < 60) {
              remainingFormatted = `${Math.ceil(remainingSec)}s left`;
            } else {
              const remainingHours = Math.floor(remainingSec / 3600);
              const remainingMin = Math.ceil((remainingSec % 3600) / 60);
              remainingFormatted = remainingHours > 0 ? `${remainingHours}h ${remainingMin}m left` : `${remainingMin}m left`;
            }
            remainingTime = `S${latest.seasonNumber || 1}:E${latest.episodeNumber || 1} • ${remainingFormatted}`;
          }
        }
      } else {
        const pos = Math.max(0, latest.positionSeconds);
        progressRatio = effectiveDuration > 0 ? Math.min(1.0, Math.max(0.0, pos / effectiveDuration)) : 0.0;

        if (latest.status === "COMPLETED" || progressRatio >= 0.9) {
          isCompleted = true;
          progressRatio = 1.0;
          status = "COMPLETED";
          remainingTime = "Completed";
        } else {
          status = "IN_PROGRESS";
          const remainingSec = Math.max(0, effectiveDuration - pos);
          if (remainingSec < 60) {
            remainingTime = `${Math.ceil(remainingSec)}s left`;
          } else {
            const remainingHours = Math.floor(remainingSec / 3600);
            const remainingMin = Math.ceil((remainingSec % 3600) / 60);
            remainingTime = remainingHours > 0 ? `${remainingHours}h ${remainingMin}m left` : `${remainingMin}m left`;
          }
        }
      }

      const summaryItem = {
        movieId: mId,
        movieSlug: movieDoc?.slug || undefined,
        movieTitle: latest.title,
        movieType: isSeries ? "SERIES" : "MOVIE",
        positionSeconds: latest.positionSeconds,
        durationSeconds: effectiveDuration,
        progressRatio: Math.round(progressRatio * 1000) / 1000,
        progressPercentage: Math.round(progressRatio * 100),
        status,
        isCompleted,
        seasonNumber: latest.seasonNumber,
        episodeNumber: latest.episodeNumber,
        episodeTitle: latest.episodeTitle,
        remainingTime,
        lastWatchedAt: latest.lastWatchedAt
      };

      summaryMap[mId] = summaryItem;
      if (movieDoc?.slug) {
        summaryMap[movieDoc.slug.toLowerCase()] = summaryItem;
      }
      if (latest.title) {
        summaryMap[latest.title.toLowerCase()] = summaryItem;
      }
      if (movieDoc?.title) {
        summaryMap[movieDoc.title.toLowerCase()] = summaryItem;
      }
    }

    return summaryMap;
  }
}
