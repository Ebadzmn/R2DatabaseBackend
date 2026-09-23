import { Router } from "express";
import { MovieController } from "./movie.controller";
import { authenticateAdmin } from "../../middleware/auth.middleware";
import { validateRequest } from "../../middleware/validation.middleware";
import {
  createMovieSchema,
  updateMovieSchema,
  queryMoviesSchema
} from "./movie.validation";

const router = Router();

router.use(authenticateAdmin);

router.get("/", validateRequest(queryMoviesSchema), MovieController.getAll);
router.get("/:id", MovieController.getById);
router.post("/", validateRequest(createMovieSchema), MovieController.create);
router.patch("/:id", validateRequest(updateMovieSchema), MovieController.update);
router.delete("/:id", MovieController.delete);

router.post("/:id/process", MovieController.process);
router.post("/:id/reprocess", MovieController.reprocess);
router.get("/:id/status", MovieController.getStatus);

// Series Season & Episode Routes
router.post("/:id/episodes", MovieController.addEpisode);
router.patch("/:id/episodes/:episodeId", MovieController.updateEpisode);
router.delete("/:id/episodes/:episodeId", MovieController.deleteEpisode);
router.post("/:id/seasons/import-tmdb", MovieController.importTmdbEpisodes);

export default router;
