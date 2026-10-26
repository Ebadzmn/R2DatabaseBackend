import { Types } from "mongoose";
import { Category, ICategory } from "./category.model";
import { Movie } from "../movies/movie.model";
import { CreateCategoryInput, UpdateCategoryInput } from "./category.validation";
import { slugify } from "../../utils/slugify";
import { BadRequestError, NotFoundError } from "../../utils/errors";
import { logger } from "../../utils/logger";

export class CategoryService {
  /**
   * Retrieves all categories.
   * If includeInactive is false, only active categories are returned.
   * Also computes movieCount for admin dashboard insights.
   */
  public static async getAll(includeInactive: boolean = false) {
    const filter: Record<string, unknown> = {};
    if (!includeInactive) {
      filter.isActive = true;
    }

    const categories = await Category.find(filter).sort({ order: 1, createdAt: 1 }).lean();

    // Compute movie count for each category
    const categoryCounts = await Promise.all(
      categories.map(async (cat) => {
        const count = await Movie.countDocuments({
          $or: [
            { categoryId: cat._id },
            { category: cat.slug },
            { category: { $regex: new RegExp(`^${cat.name}$`, "i") } }
          ]
        });
        return {
          ...cat,
          _id: cat._id.toString(),
          movieCount: count
        };
      })
    );

    return categoryCounts;
  }

  /**
   * Retrieves single category by ID
   */
  public static async getById(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestError("Invalid category ID format");
    }
    const category = await Category.findById(id);
    if (!category) {
      throw new NotFoundError("Category not found");
    }
    return category;
  }

  /**
   * Retrieves single category by Slug
   */
  public static async getBySlug(slug: string) {
    const category = await Category.findOne({ slug: slug.toLowerCase() });
    if (!category) {
      throw new NotFoundError(`Category with slug '${slug}' not found`);
    }
    return category;
  }

  /**
   * Creates a new category
   */
  public static async create(input: CreateCategoryInput): Promise<ICategory> {
    const slug = input.slug ? slugify(input.slug) : slugify(input.name);

    const existing = await Category.findOne({ slug });
    if (existing) {
      throw new BadRequestError(`A category with slug '${slug}' already exists`);
    }

    const category = await Category.create({
      name: input.name,
      slug,
      icon: input.icon || "category",
      description: input.description,
      order: input.order ?? 0,
      isActive: input.isActive ?? true
    });

    logger.info(`Category created: ${category.name} (${category.slug})`);
    return category;
  }

  /**
   * Updates an existing category
   */
  public static async update(id: string, input: UpdateCategoryInput): Promise<ICategory> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestError("Invalid category ID format");
    }

    const category = await Category.findById(id);
    if (!category) {
      throw new NotFoundError("Category not found");
    }

    if (input.name !== undefined) category.name = input.name;
    if (input.slug !== undefined) {
      const newSlug = slugify(input.slug || input.name || category.name);
      if (newSlug !== category.slug) {
        const existing = await Category.findOne({ slug: newSlug, _id: { $ne: category._id } });
        if (existing) {
          throw new BadRequestError(`Category with slug '${newSlug}' already exists`);
        }
        category.slug = newSlug;
      }
    }
    if (input.icon !== undefined) category.icon = input.icon;
    if (input.description !== undefined) category.description = input.description;
    if (input.order !== undefined) category.order = input.order;
    if (input.isActive !== undefined) category.isActive = input.isActive;

    await category.save();
    logger.info(`Category updated: ${category.name} (${category.slug})`);
    return category;
  }

  /**
   * Deletes a category by ID
   */
  public static async delete(id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestError("Invalid category ID format");
    }

    const category = await Category.findById(id);
    if (!category) {
      throw new NotFoundError("Category not found");
    }

    // Optional: unlink or reset category on movies
    await Movie.updateMany(
      { $or: [{ categoryId: category._id }, { category: category.slug }] },
      { $unset: { categoryId: 1, category: 1 } }
    );

    await category.deleteOne();
    logger.info(`Category deleted: ${category.name} (${category.slug})`);
  }

  /**
   * Seeds default categories if collection is empty
   */
  public static async seedDefaultCategories(): Promise<void> {
    try {
      const count = await Category.countDocuments();
      if (count === 0) {
        const defaultCategories = [
          { name: "Movies", slug: "movies", icon: "movie", order: 1, isActive: true },
          { name: "Sports", slug: "sports", icon: "sports", order: 2, isActive: true },
          { name: "TV Shows", slug: "tv-shows", icon: "tv", order: 3, isActive: true },
          { name: "Series", slug: "series", icon: "series", order: 4, isActive: true },
          { name: "Documentary", slug: "documentary", icon: "documentary", order: 5, isActive: true }
        ];

        await Category.insertMany(defaultCategories);
        logger.info("Successfully seeded 5 default categories: Movies, Sports, TV Shows, Series, Documentary");
      }
    } catch (err: any) {
      logger.error("Failed to seed default categories:", err);
    }
  }
}
