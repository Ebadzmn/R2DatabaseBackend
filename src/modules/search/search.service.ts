import { Movie } from "../movies/movie.model";

export class SearchService {
  /**
   * Comprehensive search with regex substring matching, filters, and smart sorting
   */
  public static async search(params: {
    q?: string;
    search?: string;
    type?: string;
    genre?: string;
    studio?: string;
    category?: string;
    year?: number;
    sortBy?: string;
    sort_by?: string;
    page?: number;
    limit?: number;
  }) {
    const filter: Record<string, unknown> = {};

    // Only ready/transcoded items for user search
    filter.status = "READY";

    // Media type filter ("ALL", "MOVIE", "SERIES")
    const type = (params.type || "").toUpperCase();
    if (type === "MOVIE" || type === "SERIES") {
      filter.type = type;
    }

    // Genre filter
    const genre = params.genre;
    if (genre && genre !== "All" && genre !== "ALL") {
      filter.genres = { $regex: new RegExp(genre.trim(), "i") };
    }

    // Studio / Category filter
    const studio = params.studio || params.category;
    if (studio && studio !== "All Studios" && studio !== "ALL") {
      filter.$or = [
        { category: { $regex: new RegExp(studio.trim(), "i") } },
        { studio: { $regex: new RegExp(studio.trim(), "i") } }
      ];
    }

    if (params.year && !isNaN(Number(params.year))) {
      filter.releaseYear = Number(params.year);
    }

    // Query text match across title, slug, description, genres, director, cast
    const queryString = (params.q || params.search || "").trim();
    if (queryString.length > 0) {
      const escaped = queryString.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const searchRegex = new RegExp(escaped, "i");
      const searchOr = [
        { title: { $regex: searchRegex } },
        { slug: { $regex: searchRegex } },
        { description: { $regex: searchRegex } },
        { genres: { $regex: searchRegex } },
        { director: { $regex: searchRegex } },
        { "cast.name": { $regex: searchRegex } }
      ];

      if (filter.$or) {
        filter.$and = [
          { $or: filter.$or },
          { $or: searchOr }
        ];
        delete filter.$or;
      } else {
        filter.$or = searchOr;
      }
    }

    // Sorting: Pinned items always prioritized, then secondary sort
    const sort: Record<string, 1 | -1> = { isPinned: -1 };
    const sortBy = (params.sortBy || params.sort_by || "relevance").toLowerCase();

    if (sortBy === "rating") {
      sort.rating = -1;
      sort.createdAt = -1;
    } else if (sortBy === "newest" || sortBy === "latest") {
      sort.releaseYear = -1;
      sort.createdAt = -1;
    } else if (sortBy === "title" || sortBy === "a-z") {
      sort.title = 1;
    } else {
      // Relevance
      sort.rating = -1;
      sort.createdAt = -1;
    }

    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(params.limit) || 30));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      Movie.find(filter)
        .populate("categoryId", "name slug icon")
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),
      Movie.countDocuments(filter)
    ]);

    return {
      items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        query: queryString
      }
    };
  }

  /**
   * Returns dynamic trending search keywords and genres from the database
   */
  public static async getTrendingKeywords() {
    const [topMedia, topGenres] = await Promise.all([
      Movie.find({ status: "READY" })
        .sort({ isPinned: -1, rating: -1, createdAt: -1 })
        .limit(8)
        .select("title type rating")
        .lean(),
      Movie.distinct("genres", { status: "READY" })
    ]);

    const keywords = topMedia.map((m) => m.title);
    const flattenedGenres = Array.from(
      new Set(
        topGenres
          .flatMap((g) => (Array.isArray(g) ? g : [g]))
          .filter(Boolean)
          .map((g) => String(g).trim())
      )
    ).slice(0, 10);

    return {
      trendingKeywords: keywords,
      popularGenres: flattenedGenres
    };
  }
}
