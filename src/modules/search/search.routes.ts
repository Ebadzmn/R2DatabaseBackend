import { Router } from "express";
import { SearchController } from "./search.controller";

const router = Router();

// GET /api/v1/search/trending-keywords
router.get("/trending-keywords", SearchController.getTrendingKeywords);

// GET /api/v1/search?q=...&genre=...&type=...&sortBy=...
router.get("/", SearchController.search);

export default router;
