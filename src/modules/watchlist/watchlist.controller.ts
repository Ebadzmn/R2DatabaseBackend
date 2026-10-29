import { Request, Response, NextFunction } from "express";
import { WatchlistService } from "./watchlist.service";
import { sendSuccess } from "../../utils/response";
import { BadRequestError } from "../../utils/errors";

export class WatchlistController {
  /**
   * GET /api/v1/watchlist
   */
  public static async getWatchlist(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        // Unauthenticated or guest fallback
        sendSuccess(res, []);
        return;
      }

      const category = (req.query.category as string) || (req.query.filter as string);
      const sortBy = req.query.sortBy as string;

      const items = await WatchlistService.getUnifiedWatchlist(userId, {
        category,
        sortBy
      });

      sendSuccess(res, items);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/watchlist
   */
  public static async addToWatchlist(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw new BadRequestError("User authentication required");
      }

      const movieId = req.body.movieId || req.body.movie_id;
      if (!movieId) {
        throw new BadRequestError("movieId or movie_id is required");
      }

      const result = await WatchlistService.addToWatchlist(userId, movieId);
      sendSuccess(res, result, "Added to watchlist successfully", 201);
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/v1/watchlist/:movieId
   */
  public static async removeFromWatchlist(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw new BadRequestError("User authentication required");
      }

      const movieId = req.params.movieId;
      if (!movieId) {
        throw new BadRequestError("movieId parameter is required");
      }

      const removed = await WatchlistService.removeFromWatchlist(userId, movieId);
      sendSuccess(res, { removed, movieId });
    } catch (err) {
      next(err);
    }
  }
}
