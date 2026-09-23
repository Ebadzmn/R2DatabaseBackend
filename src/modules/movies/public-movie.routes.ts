import { Router } from "express";
import { MovieController } from "./movie.controller";
import { validateRequest } from "../../middleware/validation.middleware";
import { queryMoviesSchema } from "./movie.validation";

const router = Router();

// Public routes for Flutter mobile application or website
router.get("/", validateRequest(queryMoviesSchema), MovieController.getAll);
router.get("/:id", MovieController.getById);
router.get("/:id/playback", MovieController.getPlayback);
router.get("/:id/stream", MovieController.streamHlsProxy);
router.get("/:id/stream/*", MovieController.streamHlsProxy);

// Episode specific playback and HLS streaming routes
router.get("/:id/seasons/:season/episodes/:episode/playback", MovieController.getEpisodePlayback);
router.get("/:id/seasons/:season/episodes/:episode/stream", MovieController.streamEpisodeHlsProxy);
router.get("/:id/seasons/:season/episodes/:episode/stream/*", MovieController.streamEpisodeHlsProxy);

export default router;
