import { Router } from "express";
import { PlaybackController } from "./playback.controller";
import { authenticateUser } from "../../middleware/app-auth.middleware";
import { validateRequest } from "../../middleware/validation.middleware";
import {
  recordProgressSchema,
  getProgressQuerySchema,
  getWatchHistoryQuerySchema
} from "./playback.validation";

export const playbackRoutes = Router();

// All playback and watch history endpoints require valid user authentication
playbackRoutes.use(authenticateUser);

// Progress tracking & heartbeat
playbackRoutes.post("/progress", validateRequest(recordProgressSchema), PlaybackController.recordProgress);
playbackRoutes.post("/heartbeat", validateRequest(recordProgressSchema), PlaybackController.recordProgress);

// Get progress for resume playback
playbackRoutes.get("/progress/:movieId", validateRequest(getProgressQuerySchema), PlaybackController.getProgress);

// Continue Watching list
playbackRoutes.get("/continue-watching", PlaybackController.getContinueWatching);

// Playback summary for all titles (fast client-side hydration)
playbackRoutes.get("/summary", PlaybackController.getPlaybackSummary);

// Full Watch History
playbackRoutes.get("/history", validateRequest(getWatchHistoryQuerySchema), PlaybackController.getWatchHistory);
playbackRoutes.delete("/history/:id", PlaybackController.removeHistoryItem);
playbackRoutes.delete("/history", PlaybackController.clearAllHistory);

export default playbackRoutes;
