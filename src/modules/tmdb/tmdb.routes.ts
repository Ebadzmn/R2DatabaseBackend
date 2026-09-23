import { Router, Request, Response, NextFunction } from "express";
import { tmdbService } from "../../services/tmdb.service";
import { authenticateAdmin } from "../../middleware/auth.middleware";
import { sendSuccess } from "../../utils/response";

const router = Router();

// Protect all TMDB routes with admin authentication
router.use(authenticateAdmin);

/**
 * Search TMDB
 * GET /api/admin/tmdb/search?query=Avatar&type=movie|tv|multi&page=1
 */
router.get("/search", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = req.query.query as string;
    const type = (req.query.type as "movie" | "tv" | "multi") || "multi";
    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;

    const results = await tmdbService.search(query, type, page);
    sendSuccess(res, results);
  } catch (error) {
    next(error);
  }
});

/**
 * Get TMDB Details
 * GET /api/admin/tmdb/details/:id?type=movie|tv
 */
router.get("/details/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const type = (req.query.type as "movie" | "tv") || "movie";

    const details = await tmdbService.getDetails(id, type);
    sendSuccess(res, details);
  } catch (error) {
    next(error);
  }
});

/**
 * Get Season & Episodes for TV series
 * GET /api/admin/tmdb/tv/:id/season/:seasonNumber
 */
router.get("/tv/:id/season/:seasonNumber", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id, seasonNumber } = req.params;
    const episodes = await tmdbService.getSeasonEpisodes(id, parseInt(seasonNumber, 10));
    sendSuccess(res, episodes);
  } catch (error) {
    next(error);
  }
});

export default router;
