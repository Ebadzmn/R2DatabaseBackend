import { Types } from "mongoose";
import { HeroBanner, IHeroBanner } from "./banner.model";
import { HomeSection, IHomeSection } from "./section.model";
import { Movie } from "../movies/movie.model";
import { NotFoundError, BadRequestError } from "../../utils/errors";

export class ContentService {
  /**
   * Ensures essential default sections and banners exist
   */
  public static async ensureDefaultContent(): Promise<void> {
    try {
      // 1. Check & Seed Home Sections
      const existingSectionsCount = await HomeSection.countDocuments();
      if (existingSectionsCount === 0) {
        const movies = await Movie.find({ type: "MOVIE", status: "READY" }).limit(10);
        const series = await Movie.find({ type: "SERIES" }).limit(10);

        const movieItems = movies.map((m, idx) => ({
          movieId: m._id,
          order: idx + 1,
          customTag: idx === 0 ? "IMAX ULTIMATE" : idx === 1 ? "DOLBY 4K" : undefined
        }));

        const seriesItems = series.map((s, idx) => ({
          movieId: s._id,
          order: idx + 1
        }));

        await HomeSection.create([
          {
            key: "top_10_blockbusters",
            title: "Top 10 Blockbusters",
            subtitle: "Global Box Office & Streaming Hits",
            sectionType: "TOP_10",
            contentType: "MOVIE",
            maxItems: 10,
            order: 1,
            isActive: true,
            isSystem: true,
            items: movieItems
          },
          {
            key: "top_series",
            title: "Top TV Series & Shows",
            subtitle: "Binge-Worthy Television Shows",
            sectionType: "SERIES_ROW",
            contentType: "SERIES",
            maxItems: 20,
            order: 2,
            isActive: true,
            isSystem: true,
            items: seriesItems
          },
          {
            key: "trending_movies",
            title: "Trending Movies",
            subtitle: "What Everyone is Watching Right Now",
            sectionType: "MOVIE_ROW",
            contentType: "MOVIE",
            maxItems: 20,
            order: 3,
            isActive: true,
            isSystem: false,
            items: movieItems.slice(0, 6)
          },
          {
            key: "peacock_picks",
            title: "Editor's Top Picks",
            subtitle: "Critically Acclaimed & Award Winning",
            sectionType: "MOVIE_ROW",
            contentType: "MIXED",
            maxItems: 20,
            order: 4,
            isActive: true,
            isSystem: false,
            items: [...movieItems.slice(0, 3), ...seriesItems.slice(0, 3)]
          }
        ]);
      }

      // Ensure Latest Movies section exists with 12 items limit & system protection
      let latestMoviesSec = await HomeSection.findOne({ key: "latest_movies" });
      if (!latestMoviesSec) {
        const highest = await HomeSection.findOne().sort({ order: -1 });
        const nextOrder = highest ? highest.order + 1 : 1;
        await HomeSection.create({
          key: "latest_movies",
          title: "Latest Movies",
          subtitle: "Fresh Releases & Top Additions",
          sectionType: "GRID",
          contentType: "MOVIE",
          maxItems: 12,
          order: nextOrder,
          isActive: true,
          isSystem: true,
          items: []
        });
      } else if (!latestMoviesSec.isSystem || latestMoviesSec.maxItems !== 12) {
        latestMoviesSec.isSystem = true;
        latestMoviesSec.maxItems = 12;
        await latestMoviesSec.save();
      }

      // Ensure Latest Series section exists with 12 items limit & system protection
      let latestSeriesSec = await HomeSection.findOne({ key: "latest_series" });
      if (!latestSeriesSec) {
        const highest = await HomeSection.findOne().sort({ order: -1 });
        const nextOrder = highest ? highest.order + 1 : 2;
        await HomeSection.create({
          key: "latest_series",
          title: "Latest Series",
          subtitle: "Binge-Worthy TV Series & Episodes",
          sectionType: "SERIES_ROW",
          contentType: "SERIES",
          maxItems: 12,
          order: nextOrder,
          isActive: true,
          isSystem: true,
          items: []
        });
      } else if (!latestSeriesSec.isSystem || latestSeriesSec.maxItems !== 12) {
        latestSeriesSec.isSystem = true;
        latestSeriesSec.maxItems = 12;
        await latestSeriesSec.save();
      }

      // 2. Check & Seed Hero Banners
      const existingBannersCount = await HeroBanner.countDocuments();
      if (existingBannersCount === 0) {
        const topMedia = await Movie.find({ status: "READY" }).sort({ rating: -1 }).limit(3);
        if (topMedia.length > 0) {
          const banners = topMedia.map((m, idx) => ({
            title: m.title,
            subtitle: m.description ? m.description.slice(0, 100) : "Featured Presentation",
            mediaType: m.type === "SERIES" ? "SERIES" : "MOVIE",
            movieId: m._id,
            badge: idx === 0 ? "EXCLUSIVE PREMIERE" : idx === 1 ? "TOP RATED" : "POPULAR",
            ctaText: "WATCH NOW",
            ctaAction: "PLAY",
            order: idx + 1,
            isActive: true
          }));
          await HeroBanner.create(banners);
        }
      }
    } catch (err) {
      console.error("Failed to seed default CMS content:", err);
    }
  }

  // ==========================================
  // Hero Banners Management
  // ==========================================

  public static async getAllBanners(adminMode = false): Promise<IHeroBanner[]> {
    await this.ensureDefaultContent();
    const filter = adminMode ? {} : { isActive: true };
    return HeroBanner.find(filter)
      .populate("movieId", "title slug poster backdrop type rating releaseYear genres duration totalSeasons episodes")
      .sort({ order: 1, createdAt: -1 });
  }

  public static async createBanner(data: any): Promise<IHeroBanner> {
    if (!data.title) {
      throw new BadRequestError("Banner title is required");
    }

    if (data.order === undefined) {
      const highest = await HeroBanner.findOne().sort({ order: -1 });
      data.order = highest ? highest.order + 1 : 1;
    }

    if (data.movieId && Types.ObjectId.isValid(data.movieId)) {
      data.movieId = new Types.ObjectId(data.movieId);
    }

    const banner = await HeroBanner.create(data);
    return (await HeroBanner.findById(banner._id).populate(
      "movieId",
      "title slug poster backdrop type rating releaseYear genres duration totalSeasons"
    ))!;
  }

  public static async updateBanner(id: string, data: any): Promise<IHeroBanner> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestError("Invalid banner ID");
    }

    if (data.movieId && Types.ObjectId.isValid(data.movieId)) {
      data.movieId = new Types.ObjectId(data.movieId);
    }

    const updated = await HeroBanner.findByIdAndUpdate(id, data, { new: true }).populate(
      "movieId",
      "title slug poster backdrop type rating releaseYear genres duration totalSeasons"
    );

    if (!updated) {
      throw new NotFoundError("Hero banner not found");
    }

    return updated;
  }

  public static async deleteBanner(id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestError("Invalid banner ID");
    }
    const result = await HeroBanner.findByIdAndDelete(id);
    if (!result) {
      throw new NotFoundError("Hero banner not found");
    }
  }

  public static async reorderBanners(orderedIds: string[]): Promise<void> {
    if (!Array.isArray(orderedIds)) {
      throw new BadRequestError("orderedIds must be an array of IDs");
    }

    const updates = orderedIds.map((id, index) => {
      if (Types.ObjectId.isValid(id)) {
        return HeroBanner.findByIdAndUpdate(id, { order: index + 1 });
      }
      return null;
    });

    await Promise.all(updates.filter(Boolean));
  }

  // ==========================================
  // Home Sections Management
  // ==========================================

  public static async getAllSections(adminMode = false): Promise<IHomeSection[]> {
    await this.ensureDefaultContent();
    const filter = adminMode ? {} : { isActive: true };
    return HomeSection.find(filter)
      .populate({
        path: "items.movieId",
        select: "title slug poster backdrop type rating releaseYear genres duration totalSeasons episodes status"
      })
      .sort({ order: 1, createdAt: 1 });
  }

  public static async getSectionById(idOrKey: string): Promise<IHomeSection> {
    const isId = Types.ObjectId.isValid(idOrKey);
    const filter = isId ? { _id: idOrKey } : { key: idOrKey.toLowerCase() };
    const section = await HomeSection.findOne(filter).populate({
      path: "items.movieId",
      select: "title slug poster backdrop type rating releaseYear genres duration totalSeasons episodes status"
    });

    if (!section) {
      throw new NotFoundError("Home section not found");
    }
    return section;
  }

  public static async createSection(data: any): Promise<IHomeSection> {
    if (!data.title) {
      throw new BadRequestError("Section title is required");
    }

    const slugKey = (data.key || data.title)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "");

    const existing = await HomeSection.findOne({ key: slugKey });
    if (existing) {
      throw new BadRequestError(`A section with key '${slugKey}' already exists`);
    }

    if (data.order === undefined) {
      const highest = await HomeSection.findOne().sort({ order: -1 });
      data.order = highest ? highest.order + 1 : 1;
    }

    const section = await HomeSection.create({
      ...data,
      key: slugKey,
      isSystem: false
    });

    return section;
  }

  public static async updateSection(id: string, data: any): Promise<IHomeSection> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestError("Invalid section ID");
    }

    // Do not allow key or isSystem to be arbitrarily changed if system
    delete data.isSystem;

    const updated = await HomeSection.findByIdAndUpdate(id, data, { new: true }).populate({
      path: "items.movieId",
      select: "title slug poster backdrop type rating releaseYear genres duration totalSeasons episodes status"
    });

    if (!updated) {
      throw new NotFoundError("Home section not found");
    }

    return updated;
  }

  public static async updateSectionItems(
    id: string,
    rawItems: Array<{ movieId: string; order?: number; customTag?: string }>
  ): Promise<IHomeSection> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestError("Invalid section ID");
    }

    const section = await HomeSection.findById(id);
    if (!section) {
      throw new NotFoundError("Home section not found");
    }

    const sanitizedItems = rawItems
      .filter((item) => Types.ObjectId.isValid(item.movieId))
      .map((item, idx) => ({
        movieId: new Types.ObjectId(item.movieId),
        order: item.order !== undefined ? item.order : idx + 1,
        customTag: item.customTag?.trim() || undefined
      }));

    if (section.maxItems && sanitizedItems.length > section.maxItems) {
      sanitizedItems.length = section.maxItems;
    }

    section.items = sanitizedItems as any;
    await section.save();

    return (await HomeSection.findById(id).populate({
      path: "items.movieId",
      select: "title slug poster backdrop type rating releaseYear genres duration totalSeasons episodes status"
    }))!;
  }

  public static async deleteSection(id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestError("Invalid section ID");
    }

    const section = await HomeSection.findById(id);
    if (!section) {
      throw new NotFoundError("Home section not found");
    }

    if (
      section.isSystem ||
      ["latest_movies", "latest_series", "top_10_blockbusters", "top_series"].includes(section.key)
    ) {
      throw new BadRequestError(
        "System sections (Latest Movies, Latest Series, Top 10, Top Series) cannot be deleted. You can reorder or toggle their visibility instead."
      );
    }

    await HomeSection.findByIdAndDelete(id);
  }

  public static async reorderSections(orderedIds: string[]): Promise<void> {
    if (!Array.isArray(orderedIds)) {
      throw new BadRequestError("orderedIds must be an array of IDs");
    }

    const updates = orderedIds.map((id, index) => {
      if (Types.ObjectId.isValid(id)) {
        return HomeSection.findByIdAndUpdate(id, { order: index + 1 });
      }
      return null;
    });

    await Promise.all(updates.filter(Boolean));
  }

  // ==========================================
  // Public Feed Aggregation (Mobile App API)
  // ==========================================

  public static async getPublicHomeFeed(): Promise<{
    heroBanners: any[];
    sections: any[];
  }> {
    const [rawBanners, rawSections] = await Promise.all([
      this.getAllBanners(false),
      this.getAllSections(false)
    ]);

    // Format banners for clean consumption
    const heroBanners = rawBanners.map((banner) => {
      const movie: any = banner.movieId;
      return {
        id: banner._id.toString(),
        title: banner.title || movie?.title || "Featured",
        subtitle: banner.subtitle || movie?.description || "",
        description: banner.description || movie?.description || "",
        badge: banner.badge || (movie?.rating ? `★ ${movie.rating}` : "FEATURED"),
        imageUrl: banner.customImageUrl || movie?.backdrop || movie?.poster || "",
        mediaType: banner.mediaType,
        ctaText: banner.ctaText || "WATCH NOW",
        ctaAction: banner.ctaAction || "PLAY",
        movie: movie
          ? {
              id: movie._id.toString(),
              title: movie.title,
              imageUrl: movie.backdrop || movie.poster,
              posterUrl: movie.poster,
              rating: movie.rating || 9.0,
              type: movie.type,
              genres: (movie.genres || []).join(", "),
              duration: movie.duration ? `${Math.floor(movie.duration / 60)}m` : "2h",
              totalSeasons: movie.totalSeasons || 0,
              isPinned: movie.isPinned ?? false
            }
          : null
      };
    });

    // Format sections
    const sections = await Promise.all(
      rawSections.map(async (sec) => {
        let items: any[] = [];
        const isLatestMovies =
          sec.key === "latest_movies" || sec.title.toLowerCase().includes("latest movie");
        const isLatestSeries =
          sec.key === "latest_series" || sec.title.toLowerCase().includes("latest series");

        if (isLatestMovies) {
          // Curated items first
          const curatedItems = sec.items
            .filter((item) => item.movieId)
            .sort((a, b) => a.order - b.order);

          const curatedIds = curatedItems.map((item) =>
            typeof item.movieId === "object" ? (item.movieId as any)._id : item.movieId
          );

          // If fewer than 12, fill up to 12 with latest movies (pinned first)
          const maxNeeded = sec.maxItems && sec.maxItems > 0 ? sec.maxItems : 12;
          const slotsLeft = Math.max(0, maxNeeded - curatedIds.length);

          let dynamicMovies: any[] = [];
          if (slotsLeft > 0) {
            dynamicMovies = await Movie.find({
              _id: { $nin: curatedIds },
              type: "MOVIE",
              status: { $in: ["READY", "DRAFT", "PROCESSING"] }
            })
              .sort({ isPinned: -1, createdAt: -1 })
              .limit(slotsLeft);
          }

          const combined = [
            ...curatedItems.map((item) => ({
              m: item.movieId as any,
              customTag: item.customTag
            })),
            ...dynamicMovies.map((m) => ({ m, customTag: undefined }))
          ].slice(0, maxNeeded);

          items = combined.map(({ m, customTag }) => ({
            id: m._id.toString(),
            title: m.title,
            imageUrl: m.poster || m.backdrop || "",
            backdropUrl: m.backdrop || m.poster || "",
            rating: m.rating || 8.5,
            releaseYear: m.releaseYear ? m.releaseYear.toString() : "2024",
            genres: Array.isArray(m.genres) ? m.genres.join(", ") : (m.genres || ""),
            duration: m.duration ? `${Math.floor(m.duration / 60)}m` : "2h",
            type: "MOVIE",
            totalSeasons: 1,
            isPinned: m.isPinned ?? false,
            rank: undefined,
            rankTag: m.isPinned ? "PINNED" : (customTag || "NEW")
          }));
        } else if (isLatestSeries) {
          // Curated series items first
          const curatedItems = sec.items
            .filter((item) => item.movieId)
            .sort((a, b) => a.order - b.order);

          const curatedIds = curatedItems.map((item) =>
            typeof item.movieId === "object" ? (item.movieId as any)._id : item.movieId
          );

          // If fewer than 12, fill up to 12 with latest series (pinned first)
          const maxNeeded = sec.maxItems && sec.maxItems > 0 ? sec.maxItems : 12;
          const slotsLeft = Math.max(0, maxNeeded - curatedIds.length);

          let dynamicSeries: any[] = [];
          if (slotsLeft > 0) {
            dynamicSeries = await Movie.find({
              _id: { $nin: curatedIds },
              type: "SERIES"
            })
              .sort({ isPinned: -1, createdAt: -1 })
              .limit(slotsLeft);
          }

          const combined = [
            ...curatedItems.map((item) => ({
              m: item.movieId as any,
              customTag: item.customTag
            })),
            ...dynamicSeries.map((m) => ({ m, customTag: undefined }))
          ].slice(0, maxNeeded);

          items = combined.map(({ m, customTag }) => ({
            id: m._id.toString(),
            title: m.title,
            imageUrl: m.poster || m.backdrop || "",
            backdropUrl: m.backdrop || m.poster || "",
            rating: m.rating || 8.5,
            releaseYear: m.releaseYear ? m.releaseYear.toString() : "2024",
            genres: Array.isArray(m.genres) ? m.genres.join(", ") : (m.genres || ""),
            duration: m.duration ? `${Math.floor(m.duration / 60)}m` : "2h",
            type: "SERIES",
            totalSeasons: m.totalSeasons || 1,
            isPinned: m.isPinned ?? false,
            rank: undefined,
            rankTag: m.isPinned ? "PINNED" : customTag
          }));
        } else {
          // Other sections (Top 10 Blockbusters, Peacock Picks, etc.)
          const sortedItems = [...sec.items].sort((a, b) => a.order - b.order);

          items = sortedItems
            .filter((item) => item.movieId)
            .map((item, idx) => {
              const m: any = item.movieId;
              return {
                id: m._id.toString(),
                title: m.title,
                imageUrl: m.poster || m.backdrop || "",
                backdropUrl: m.backdrop || m.poster || "",
                rating: m.rating || 8.5,
                releaseYear: m.releaseYear ? m.releaseYear.toString() : "2024",
                genres: Array.isArray(m.genres) ? m.genres.join(", ") : (m.genres || ""),
                duration: m.duration ? `${Math.floor(m.duration / 60)}m` : "2h",
                type: m.type || "MOVIE",
                totalSeasons: m.totalSeasons || (m.type === "SERIES" ? 1 : 0),
                isPinned: m.isPinned ?? false,
                rank: sec.sectionType === "TOP_10" ? idx + 1 : undefined,
                rankTag:
                  item.customTag ||
                  (sec.sectionType === "TOP_10" ? `#${idx + 1}` : (m.isPinned ? "PINNED" : undefined))
              };
            });
        }

        return {
          id: sec._id.toString(),
          key: sec.key,
          title: sec.title,
          subtitle: sec.subtitle,
          sectionType: sec.sectionType,
          contentType: sec.contentType,
          order: sec.order,
          isSystem: sec.isSystem ?? false,
          items
        };
      })
    );

    return { heroBanners, sections };
  }
}
