import { Request, Response, NextFunction } from "express";
import { CategoryService } from "./category.service";
import { sendSuccess } from "../../utils/response";

export class CategoryController {
  public static async getAll(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const includeInactive = req.query.includeInactive === "true";
      const categories = await CategoryService.getAll(includeInactive);
      sendSuccess(res, categories, "Categories retrieved successfully");
    } catch (error) {
      next(error);
    }
  }

  public static async getPublic(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // Only active categories for public consumer / mobile app
      const categories = await CategoryService.getAll(false);
      sendSuccess(res, categories, "Active categories retrieved successfully");
    } catch (error) {
      next(error);
    }
  }

  public static async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const category = await CategoryService.getById(req.params.id);
      sendSuccess(res, category);
    } catch (error) {
      next(error);
    }
  }

  public static async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const category = await CategoryService.create(req.body);
      sendSuccess(res, category, "Category created successfully", 201);
    } catch (error) {
      next(error);
    }
  }

  public static async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const category = await CategoryService.update(req.params.id, req.body);
      sendSuccess(res, category, "Category updated successfully");
    } catch (error) {
      next(error);
    }
  }

  public static async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await CategoryService.delete(req.params.id);
      sendSuccess(res, { deleted: true }, "Category deleted successfully");
    } catch (error) {
      next(error);
    }
  }
}
