import { Router } from "express";
import { WatchlistController } from "./watchlist.controller";
import { optionalAuthenticateUser, authenticateUser } from "../../middleware/app-auth.middleware";

export const watchlistRoutes = Router();

// GET supports optional auth (if logged in, returns user's list; if guest, empty list)
watchlistRoutes.get("/", optionalAuthenticateUser, WatchlistController.getWatchlist);

// Mutating endpoints require authentication
watchlistRoutes.post("/", authenticateUser, WatchlistController.addToWatchlist);
watchlistRoutes.delete("/:movieId", authenticateUser, WatchlistController.removeFromWatchlist);

export default watchlistRoutes;
