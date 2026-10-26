import { Router } from "express";
import { GenreController } from "./genre.controller";
import { authenticateAdmin } from "../../middleware/auth.middleware";
import { validateRequest } from "../../middleware/validation.middleware";
import { createGenreSchema, updateGenreSchema } from "./genre.validation";

// Admin Genre Routes (Protected)
export const adminGenreRouter = Router();

adminGenreRouter.use(authenticateAdmin);

adminGenreRouter.get("/", GenreController.getAll);
adminGenreRouter.get("/:id", GenreController.getById);
adminGenreRouter.post("/", validateRequest(createGenreSchema), GenreController.create);
adminGenreRouter.patch("/:id", validateRequest(updateGenreSchema), GenreController.update);
adminGenreRouter.delete("/:id", GenreController.delete);

// Public Genre Routes (Unauthenticated, for App and Website)
export const publicGenreRouter = Router();

publicGenreRouter.get("/", GenreController.getPublic);
publicGenreRouter.get("/:id", GenreController.getById);

export default adminGenreRouter;
