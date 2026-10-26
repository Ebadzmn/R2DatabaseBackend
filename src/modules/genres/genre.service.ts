import { Types } from "mongoose";
import { Genre, IGenre } from "./genre.model";
import { Movie } from "../movies/movie.model";
import { CreateGenreInput, UpdateGenreInput } from "./genre.validation";
import { slugify } from "../../utils/slugify";
import { BadRequestError, NotFoundError } from "../../utils/errors";
import { logger } from "../../utils/logger";

export class GenreService {
  /**
   * Retrieves all genres.
   * If includeInactive is false, only active genres are returned.
   * Also computes movie count for each genre.
   */
  public static async getAll(includeInactive: boolean = false) {
    const filter: Record<string, unknown> = {};
    if (!includeInactive) {
      filter.isActive = true;
    }

    const genres = await Genre.find(filter).sort({ order: 1, createdAt: 1 }).lean();

    // Compute live movie counts
    const genreCounts = await Promise.all(
      genres.map(async (genre) => {
        const count = await Movie.countDocuments({
          genres: { $regex: new RegExp(`^${genre.name}$`, "i") }
        });
        return {
          ...genre,
          _id: genre._id.toString(),
          count
        };
      })
    );

    return genreCounts;
  }

  /**
   * Retrieves single genre by ID
   */
  public static async getById(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestError("Invalid genre ID format");
    }
    const genre = await Genre.findById(id);
    if (!genre) {
      throw new NotFoundError("Genre not found");
    }
    return genre;
  }

  /**
   * Creates a new genre
   */
  public static async create(input: CreateGenreInput): Promise<IGenre> {
    const slug = input.slug ? slugify(input.slug) : slugify(input.name);

    const existing = await Genre.findOne({ slug });
    if (existing) {
      throw new BadRequestError(`A genre with slug '${slug}' already exists`);
    }

    const genre = await Genre.create({
      name: input.name,
      slug,
      icon: input.icon || "film",
      gradientStart: input.gradientStart || "#F59E0B",
      gradientEnd: input.gradientEnd || "#D97706",
      description: input.description,
      order: input.order ?? 0,
      isActive: input.isActive ?? true
    });

    logger.info(`Genre created: ${genre.name} (${genre.slug})`);
    return genre;
  }

  /**
   * Updates an existing genre
   */
  public static async update(id: string, input: UpdateGenreInput): Promise<IGenre> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestError("Invalid genre ID format");
    }

    const genre = await Genre.findById(id);
    if (!genre) {
      throw new NotFoundError("Genre not found");
    }

    const oldName = genre.name;

    if (input.name !== undefined) genre.name = input.name;
    if (input.slug !== undefined) {
      const newSlug = slugify(input.slug || input.name || genre.name);
      if (newSlug !== genre.slug) {
        const existing = await Genre.findOne({ slug: newSlug, _id: { $ne: genre._id } });
        if (existing) {
          throw new BadRequestError(`Genre with slug '${newSlug}' already exists`);
        }
        genre.slug = newSlug;
      }
    }
    if (input.icon !== undefined) genre.icon = input.icon;
    if (input.gradientStart !== undefined) genre.gradientStart = input.gradientStart;
    if (input.gradientEnd !== undefined) genre.gradientEnd = input.gradientEnd;
    if (input.description !== undefined) genre.description = input.description;
    if (input.order !== undefined) genre.order = input.order;
    if (input.isActive !== undefined) genre.isActive = input.isActive;

    await genre.save();

    // If genre name changed, update movies that had oldName in genres array
    if (input.name && input.name !== oldName) {
      await Movie.updateMany(
        { genres: oldName },
        { $set: { "genres.$": input.name } }
      );
    }

    logger.info(`Genre updated: ${genre.name} (${genre.slug})`);
    return genre;
  }

  /**
   * Deletes a genre by ID
   */
  public static async delete(id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestError("Invalid genre ID format");
    }

    const genre = await Genre.findById(id);
    if (!genre) {
      throw new NotFoundError("Genre not found");
    }

    // Optional: pull genre from movies
    await Movie.updateMany(
      { genres: genre.name },
      { $pull: { genres: genre.name } }
    );

    await genre.deleteOne();
    logger.info(`Genre deleted: ${genre.name} (${genre.slug})`);
  }

  /**
   * Seeds default popular genres if collection is empty
   */
  public static async seedDefaultGenres(): Promise<void> {
    try {
      const count = await Genre.countDocuments();
      if (count === 0) {
        const defaultGenres = [
          { name: "Action", slug: "action", icon: "flame", gradientStart: "#FF5722", gradientEnd: "#F59E0B", order: 1, isActive: true },
          { name: "Comedy", slug: "comedy", icon: "smile", gradientStart: "#FBBF24", gradientEnd: "#D97706", order: 2, isActive: true },
          { name: "Thriller", slug: "thriller", icon: "bolt", gradientStart: "#8B5CF6", gradientEnd: "#EC4899", order: 3, isActive: true },
          { name: "Horror", slug: "horror", icon: "moon", gradientStart: "#EF4444", gradientEnd: "#7F1D1D", order: 4, isActive: true },
          { name: "Sci-Fi", slug: "sci-fi", icon: "rocket", gradientStart: "#06B6D4", gradientEnd: "#3B82F6", order: 5, isActive: true },
          { name: "Drama", slug: "drama", icon: "theater", gradientStart: "#6366F1", gradientEnd: "#4F46E5", order: 6, isActive: true },
          { name: "Animation", slug: "animation", icon: "sparkles", gradientStart: "#10B981", gradientEnd: "#06B6D4", order: 7, isActive: true },
          { name: "Romance", slug: "romance", icon: "heart", gradientStart: "#F43F5E", gradientEnd: "#FB7185", order: 8, isActive: true },
          { name: "Adventure", slug: "adventure", icon: "compass", gradientStart: "#14B8A6", gradientEnd: "#0D9488", order: 9, isActive: true },
          { name: "Crime", slug: "crime", icon: "fingerprint", gradientStart: "#64748B", gradientEnd: "#DC2626", order: 10, isActive: true },
          { name: "Fantasy", slug: "fantasy", icon: "star", gradientStart: "#A855F7", gradientEnd: "#6366F1", order: 11, isActive: true },
          { name: "Mystery", slug: "mystery", icon: "eye", gradientStart: "#3B82F6", gradientEnd: "#1E3A8A", order: 12, isActive: true }
        ];

        await Genre.insertMany(defaultGenres);
        logger.info("Successfully seeded 12 default genres with curated gradients and iconography");
      }
    } catch (err: any) {
      logger.error("Failed to seed default genres:", err);
    }
  }
}
