import { Request, Response, NextFunction } from "express";
import { PlaybackService } from "./playback.service";
import { sendSuccess } from "../../utils/response";
import { UnauthorizedError } from "../../utils/errors";

export class PlaybackController {
  /**
   * POST /api/v1/playback/progress
   * POST /api/v1/playback/heartbeat
   * Records heartbeat and playback position
   */
  public static async recordProgress(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw new UnauthorizedError("Authentication required to save playback progress");
      }

      const history = await PlaybackService.recordProgress(userId, req.body);
      sendSuccess(res, history, "Playback progress recorded successfully");
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/playback/progress/:movieId
   * Retrieves saved progress for resume playback
   */
  public static async getProgress(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw new UnauthorizedError("Authentication required to get playback progress");
      }

      const movieId = req.params.movieId;
      const seasonNumber = req.query.seasonNumber
        ? parseInt(req.query.seasonNumber as string, 10)
        : undefined;
      const episodeNumber = req.query.episodeNumber
        ? parseInt(req.query.episodeNumber as string, 10)
        : undefined;

      const progress = await PlaybackService.getProgress(
        userId,
        movieId,
        seasonNumber,
        episodeNumber
      );

      sendSuccess(res, progress, "Playback progress retrieved successfully");
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/playback/continue-watching
   * Returns items currently in progress
   */
  public static async getContinueWatching(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw new UnauthorizedError("Authentication required to get continue watching list");
      }

      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
      const items = await PlaybackService.getContinueWatching(userId, limit);

      sendSuccess(res, items, "Continue watching items retrieved successfully");
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/playback/history
   * Returns complete watch history with pagination and status filter
   */
  public static async getWatchHistory(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw new UnauthorizedError("Authentication required to view watch history");
      }

      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
      const status = req.query.status as string | undefined;

      const result = await PlaybackService.getWatchHistory(userId, { page, limit, status });
      sendSuccess(
        res,
        result.items,
        "Watch history retrieved successfully",
        200,
        {
          total: result.total,
          page: result.page,
          totalPages: result.totalPages
        }
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/v1/playback/history/:id
   * Removes a specific item from watch history
   */
  public static async removeHistoryItem(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw new UnauthorizedError("Authentication required to delete history item");
      }

      const success = await PlaybackService.removeHistoryItem(userId, req.params.id);
      sendSuccess(res, { success }, "History item removed successfully");
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/v1/playback/history
   * Clears all watch history for user
   */
  public static async clearAllHistory(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw new UnauthorizedError("Authentication required to clear watch history");
      }

      const count = await PlaybackService.clearAllHistory(userId);
      sendSuccess(res, { count }, "Watch history cleared successfully");
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/v1/playback/summary
   * Fast key-value progress summary for client-side card hydration
   */
  public static async getPlaybackSummary(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        sendSuccess(res, {});
        return;
      }

      const summary = await PlaybackService.getPlaybackSummary(userId);
      sendSuccess(res, summary, "Playback summary retrieved successfully");
    } catch (error) {
      next(error);
    }
  }
}
