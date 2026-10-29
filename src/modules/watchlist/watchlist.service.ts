import { Types } from "mongoose";
import { Watchlist } from "./watchlist.model";
import { WatchHistory, IWatchHistory } from "../playback/playback.model";
import { Movie, IMovie } from "../movies/movie.model";
import { BadRequestError, NotFoundError } from "../../utils/errors";

export interface WatchlistFilterOptions {
  category?: string; // 'All Saved', 'In Progress', 'Completed', 'Movies', 'Series'
  sortBy?: string;   // 'Recently Added', 'Recently Watched', 'Rating', 'Release Year'
}

export class WatchlistService {
  /**
   * Adds a movie or series to the user's saved watchlist
   */
  public static async addToWatchlist(
    userId: string | Types.ObjectId,
    movieIdOrSlug: string
  ): Promise<any> {
    const userObjectId = typeof userId === "string" ? new Types.ObjectId(userId) : userId;

    let movie = null;
    if (Types.ObjectId.isValid(movieIdOrSlug)) {
      movie = await Movie.findById(movieIdOrSlug);
    }
    if (!movie) {
      movie = await Movie.findOne({ slug: movieIdOrSlug.toLowerCase() });
    }
    if (!movie) {
      throw new NotFoundError("Movie or series not found");
    }

    const item = await Watchlist.findOneAndUpdate(
      { userId: userObjectId, movieId: movie._id },
      { $setOnInsert: { userId: userObjectId, movieId: movie._id } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return {
      success: true,
      movieId: movie._id.toString(),
      title: movie.title,
      isBookmarked: true
    };
  }

  /**
   * Removes a movie or series from the user's saved watchlist
   */
  public static async removeFromWatchlist(
    userId: string | Types.ObjectId,
    movieIdOrSlug: string
  ): Promise<boolean> {
    const userObjectId = typeof userId === "string" ? new Types.ObjectId(userId) : userId;

    let movieObjectId: Types.ObjectId | null = null;
    if (Types.ObjectId.isValid(movieIdOrSlug)) {
      movieObjectId = new Types.ObjectId(movieIdOrSlug);
    } else {
      const movie = await Movie.findOne({ slug: movieIdOrSlug.toLowerCase() }).select("_id");
      if (movie) movieObjectId = movie._id;
    }

    if (!movieObjectId) {
      return false;
    }

    const result = await Watchlist.deleteOne({ userId: userObjectId, movieId: movieObjectId });
    return (result.deletedCount ?? 0) > 0;
  }

  /**
   * Checks if an item is explicitly bookmarked in the user's watchlist
   */
  public static async isBookmarked(
    userId: string | Types.ObjectId,
    movieId: string
  ): Promise<boolean> {
    if (!userId || !movieId) return false;
    const userObjectId = typeof userId === "string" ? new Types.ObjectId(userId) : userId;
    let movieObjectId: Types.ObjectId | null = null;
    if (Types.ObjectId.isValid(movieId)) {
      movieObjectId = new Types.ObjectId(movieId);
    } else {
      const movie = await Movie.findOne({ slug: movieId.toLowerCase() }).select("_id");
      if (movie) movieObjectId = movie._id;
    }
    if (!movieObjectId) return false;

    const count = await Watchlist.countDocuments({ userId: userObjectId, movieId: movieObjectId });
    return count > 0;
  }

  /**
   * Unified Watchlist:
   * Merges explicitly bookmarked content AND content the user has watched or started watching,
   * with accurate watch progress, completion status, deduplication, and rich metadata.
   */
  public static async getUnifiedWatchlist(
    userId: string | Types.ObjectId,
    options: WatchlistFilterOptions = {}
  ): Promise<any[]> {
    const userObjectId = typeof userId === "string" ? new Types.ObjectId(userId) : userId;

    // 1. Fetch user's explicit bookmarks
    const bookmarkedDocs = await Watchlist.find({ userId: userObjectId })
      .sort({ createdAt: -1 })
      .populate("movieId");

    // 2. Fetch all watch history items for this user
    const historyDocs = await WatchHistory.find({ userId: userObjectId })
      .sort({ lastWatchedAt: -1 })
      .populate("movieId");

    // Map to store deduplicated unified items keyed by movieId string
    const unifiedMap = new Map<string, any>();

    // Process Watch History items first
    // Group history by movieId (especially for series with multiple episodes)
    const historyByMovie = new Map<string, IWatchHistory[]>();
    for (const h of historyDocs) {
      const mId = h.movieId?._id ? h.movieId._id.toString() : h.movieId.toString();
      if (!historyByMovie.has(mId)) {
        historyByMovie.set(mId, []);
      }
      historyByMovie.get(mId)!.push(h);
    }

    // Convert Watch History into unified movie entries
    for (const [mId, histories] of historyByMovie.entries()) {
      const latestHistory = histories[0]; // Already sorted by lastWatchedAt desc
      const movieDoc: any = latestHistory.movieId && (latestHistory.movieId as any).title
        ? latestHistory.movieId
        : null;

      if (!movieDoc) continue;

      const isSeries = movieDoc.type === "SERIES";
      let watchProgress = 0.0;
      let status = latestHistory.status;
      let remainingTime = "";

      let effectiveDuration = latestHistory.durationSeconds > 0
        ? latestHistory.durationSeconds
        : (movieDoc.duration > 0 ? movieDoc.duration : (isSeries ? 2700 : 7200));

      if (isSeries) {
        const totalEpisodes = movieDoc.episodes?.length || movieDoc.totalEpisodes || histories.length || 1;
        const completedEpisodes = histories.filter((h) => h.status === "COMPLETED").length;
        
        const latestEpProgress = effectiveDuration > 0
          ? Math.min(1.0, latestHistory.positionSeconds / effectiveDuration)
          : 0.0;

        if (completedEpisodes >= totalEpisodes && totalEpisodes > 0) {
          watchProgress = 1.0;
          status = "COMPLETED";
          remainingTime = "Completed";
        } else {
          const effectiveCount = Math.max(totalEpisodes, histories.length);
          watchProgress = Math.min(1.0, (completedEpisodes + (latestHistory.status === "COMPLETED" ? 0 : latestEpProgress)) / effectiveCount);
          if (watchProgress >= 0.9) {
            status = "COMPLETED";
            remainingTime = "Completed";
          } else {
            status = "IN_PROGRESS";
            const epNum = latestHistory.episodeNumber || 1;
            const remainingSec = Math.max(0, effectiveDuration - latestHistory.positionSeconds);
            const remainingHours = Math.floor(remainingSec / 3600);
            const remainingMin = Math.ceil((remainingSec % 3600) / 60);
            const remainingFormatted = remainingHours > 0 ? `${remainingHours}h ${remainingMin}m left` : `${remainingMin}m left`;
            remainingTime = `S${latestHistory.seasonNumber || 1}:E${epNum} • ${remainingFormatted}`;
          }
        }
      } else {
        // Movie progress calculation: Progress = Current Playback Position / Total Movie Duration
        const pos = Math.max(0, latestHistory.positionSeconds || 0);
        watchProgress = effectiveDuration > 0 ? Math.min(1.0, Math.max(0.0, pos / effectiveDuration)) : 0.0;

        if (status === "COMPLETED" || watchProgress >= 0.9) {
          status = "COMPLETED";
          watchProgress = 1.0;
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

      unifiedMap.set(mId, {
        id: movieDoc._id.toString(),
        movieId: movieDoc._id.toString(),
        title: movieDoc.title,
        slug: movieDoc.slug,
        subtitle: movieDoc.description ? movieDoc.description.substring(0, 60) : undefined,
        imageUrl: movieDoc.poster || latestHistory.poster || "",
        backdropUrl: movieDoc.backdrop || latestHistory.backdrop || "",
        rating: movieDoc.rating || 0.0,
        releaseYear: movieDoc.releaseYear ? movieDoc.releaseYear.toString() : "2024",
        genres: Array.isArray(movieDoc.genres) ? movieDoc.genres.join(", ") : (movieDoc.genres || "Action"),
        duration: isSeries
          ? `${movieDoc.totalSeasons || 1} Season${(movieDoc.totalSeasons || 1) > 1 ? "s" : ""}`
          : this.formatSeconds(movieDoc.duration || latestHistory.durationSeconds),
        resolution: movieDoc.resolution || "4K HDR",
        ageRating: movieDoc.ageRating || "PG-13",
        type: movieDoc.type,
        contentType: isSeries ? "Series" : "Movie",
        isSeries,
        watchProgress: Math.round(watchProgress * 100) / 100,
        positionSeconds: latestHistory.positionSeconds,
        durationSeconds: latestHistory.durationSeconds,
        seasonNumber: latestHistory.seasonNumber,
        episodeNumber: latestHistory.episodeNumber,
        episodeTitle: latestHistory.episodeTitle,
        remainingTime,
        status, // 'IN_PROGRESS' | 'COMPLETED'
        isBookmarked: false, // will update below if also in bookmarkedDocs
        isWatched: true,
        lastWatchedAt: latestHistory.lastWatchedAt,
        activityDate: latestHistory.lastWatchedAt
      });
    }

    // Now process explicit bookmarks
    for (const b of bookmarkedDocs) {
      const movieDoc: any = b.movieId;
      if (!movieDoc || !movieDoc._id) continue;
      const mId = movieDoc._id.toString();

      if (unifiedMap.has(mId)) {
        // Movie already has watch history: mark as bookmarked!
        const existing = unifiedMap.get(mId)!;
        existing.isBookmarked = true;
      } else {
        // Bookmarked but NOT yet watched
        const isSeries = movieDoc.type === "SERIES";
        unifiedMap.set(mId, {
          id: movieDoc._id.toString(),
          movieId: movieDoc._id.toString(),
          title: movieDoc.title,
          slug: movieDoc.slug,
          subtitle: movieDoc.description ? movieDoc.description.substring(0, 60) : undefined,
          imageUrl: movieDoc.poster || "",
          backdropUrl: movieDoc.backdrop || "",
          rating: movieDoc.rating || 0.0,
          releaseYear: movieDoc.releaseYear ? movieDoc.releaseYear.toString() : "2024",
          genres: Array.isArray(movieDoc.genres) ? movieDoc.genres.join(", ") : (movieDoc.genres || "Action"),
          duration: isSeries
            ? `${movieDoc.totalSeasons || 1} Season${(movieDoc.totalSeasons || 1) > 1 ? "s" : ""}`
            : this.formatSeconds(movieDoc.duration || 0),
          resolution: movieDoc.resolution || "4K HDR",
          ageRating: movieDoc.ageRating || "PG-13",
          type: movieDoc.type,
          contentType: isSeries ? "Series" : "Movie",
          isSeries,
          watchProgress: null, // Never played
          positionSeconds: 0,
          durationSeconds: movieDoc.duration || 0,
          remainingTime: null,
          status: "NOT_STARTED",
          isBookmarked: true,
          isWatched: false,
          lastWatchedAt: null,
          activityDate: (b as any).createdAt || new Date()
        });
      }
    }

    let items = Array.from(unifiedMap.values());

    // Apply category filtering
    const category = (options.category || "All Saved").trim();
    if (category === "In Progress") {
      items = items.filter((item) => item.status === "IN_PROGRESS");
    } else if (category === "Completed") {
      items = items.filter((item) => item.status === "COMPLETED");
    } else if (category === "Movies") {
      items = items.filter((item) => item.type === "MOVIE");
    } else if (category === "Series") {
      items = items.filter((item) => item.type === "SERIES");
    }

    // Apply sorting
    const sortBy = options.sortBy || "Recently Added";
    if (sortBy === "Rating") {
      items.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    } else if (sortBy === "Release Year") {
      items.sort((a, b) => parseInt(b.releaseYear || "0", 10) - parseInt(a.releaseYear || "0", 10));
    } else {
      // Default: Most recent activity (watched or added)
      items.sort((a, b) => {
        const timeA = a.activityDate ? new Date(a.activityDate).getTime() : 0;
        const timeB = b.activityDate ? new Date(b.activityDate).getTime() : 0;
        return timeB - timeA;
      });
    }

    return items;
  }

  private static formatSeconds(totalSec: number): string {
    if (!totalSec || totalSec <= 0) return "2h 00m";
    const sec = totalSec;
    if (sec < 60) return `${Math.floor(sec)}s`;
    const hours = Math.floor(sec / 3600);
    const minutes = Math.floor((sec % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
    }
    return `${minutes}m`;
  }
}
