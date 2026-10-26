import { Request, Response, NextFunction } from "express";
import { GenreService } from "./genre.service";
import { sendSuccess } from "../../utils/response";

export class GenreController {
  public static async getAll(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const includeInactive = req.query.includeInactive === "true";
      const genres = await GenreService.getAll(includeInactive);
      sendSuccess(res, genres, "Genres retrieved successfully");
    } catch (error) {
      next(error);
    }
  }

  public static async getPublic(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const genres = await GenreService.getAll(false);
      sendSuccess(res, genres, "Active genres retrieved successfully");
    } catch (error) {
      next(error);
    }
  }

  public static async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const genre = await GenreService.getById(req.params.id);
      sendSuccess(res, genre);
    } catch (error) {
      next(error);
    }
  }

  public static async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const genre = await GenreService.create(req.body);
      sendSuccess(res, genre, "Genre created successfully", 201);
    } catch (error) {
      next(error);
    }
  }

  public static async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const genre = await GenreService.update(req.params.id, req.body);
      sendSuccess(res, genre, "Genre updated successfully");
    } catch (error) {
      next(error);
    }
  }

  public static async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await GenreService.delete(req.params.id);
      sendSuccess(res, { deleted: true }, "Genre deleted successfully");
    } catch (error) {
      next(error);
    }
  }
}
