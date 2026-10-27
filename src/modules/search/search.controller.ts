import { Request, Response, NextFunction } from "express";
import { SearchService } from "./search.service";
import { sendSuccess } from "../../utils/response";

export class SearchController {
  public static async search(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await SearchService.search(req.query as any);
      sendSuccess(res, result.items, "Search results retrieved successfully", 200, result.meta);
    } catch (error) {
      next(error);
    }
  }

  public static async getTrendingKeywords(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await SearchService.getTrendingKeywords();
      sendSuccess(res, result, "Trending keywords retrieved successfully");
    } catch (error) {
      next(error);
    }
  }
}
