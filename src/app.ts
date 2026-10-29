import express, { Express, Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import authRoutes from "./modules/auth/auth.routes";
import storageRoutes from "./modules/storage/storage.routes";
import uploadRoutes from "./modules/upload/upload.routes";
import movieRoutes from "./modules/movies/movie.routes";
import publicMovieRoutes from "./modules/movies/public-movie.routes";
import tmdbRoutes from "./modules/tmdb/tmdb.routes";
import { adminCategoryRouter, publicCategoryRouter } from "./modules/categories/category.routes";
import { adminGenreRouter, publicGenreRouter } from "./modules/genres/genre.routes";
import { appAuthRoutes, appUserRoutes } from "./modules/app-auth/user.routes";
import adminUserRoutes from "./modules/app-auth/admin-user.routes";
import path from "path";
import adminContentRoutes from "./modules/content/content.routes";
import publicFeedRoutes from "./modules/content/public-feed.routes";
import searchRoutes from "./modules/search/search.routes";
import playbackRoutes from "./modules/playback/playback.routes";
import watchlistRoutes from "./modules/watchlist/watchlist.routes";
import { communityRouter, adminCommunityRouter } from "./modules/community/community.routes";
import { publicSystemRouter, adminSystemRouter } from "./modules/system/system.routes";
import { setupSwagger } from "./config/swagger";
import { errorHandler } from "./middleware/error.middleware";
import { apiRateLimiter, authRateLimiter } from "./middleware/rate-limit.middleware";
import { NotFoundError } from "./utils/errors";
import { sendSuccess } from "./utils/response";

export function createApp(): Express {
  const app = express();

  // Security headers
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

  // CORS whitelist
  app.use(
    cors({
      origin: "*", // Configure specific origins in production
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"]
    })
  );

  // HTTP Request Logging
  app.use(morgan("combined"));

  // Body parsers
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));

  // Rate Limiting
  app.use("/api/", apiRateLimiter);
  app.use("/api/admin/auth/login", authRateLimiter);

  // Swagger Documentation
  setupSwagger(app);

  // Health check endpoint
  app.get("/api/health", (_req: Request, res: Response) => {
    sendSuccess(res, {
      status: "UP",
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    });
  });

  // Static file serving for uploads (avatars, community images)
  app.use("/uploads", express.static(path.join(process.cwd(), "public", "uploads")));

  // Mount Application Routes
  app.use("/api/admin/auth", authRoutes);
  app.use("/api/admin/storage", storageRoutes);
  app.use("/api/admin/uploads", uploadRoutes);
  app.use("/api/admin/movies", movieRoutes);
  app.use("/api/admin/tmdb", tmdbRoutes);
  app.use("/api/admin/users", adminUserRoutes);
  app.use("/api/admin/categories", adminCategoryRouter);
  app.use("/api/admin/genres", adminGenreRouter);
  app.use("/api/admin/content", adminContentRoutes);
  app.use("/api/admin/community", adminCommunityRouter);
  app.use("/api/admin/system", adminSystemRouter);
  app.use("/api/admin", adminContentRoutes);
  app.use("/api/movies", publicMovieRoutes);

  // End-User Mobile Application Routes (CineCore Client)
  app.use("/api/v1/system", publicSystemRouter);
  app.use("/api/system", publicSystemRouter);
  app.use("/api/v1/auth", appAuthRoutes);
  app.use("/api/v1/users", appUserRoutes);
  app.use("/api/v1/movies", publicMovieRoutes);
  app.use("/api/v1/movies/genres", publicGenreRouter);
  app.use("/api/v1/feed", publicFeedRoutes);
  app.use("/api/feed", publicFeedRoutes);
  app.use("/api/v1/community", communityRouter);
  app.use("/api/community", communityRouter);
  app.use("/api/v1/categories", publicCategoryRouter);
  app.use("/api/v1/feed/categories", publicCategoryRouter);
  app.use("/api/categories", publicCategoryRouter);
  app.use("/api/v1/genres", publicGenreRouter);
  app.use("/api/genres", publicGenreRouter);
  app.use("/api/v1/search", searchRoutes);
  app.use("/api/search", searchRoutes);
  app.use("/api/v1/playback", playbackRoutes);
  app.use("/api/playback", playbackRoutes);
  app.use("/api/v1/watchlist", watchlistRoutes);
  app.use("/api/watchlist", watchlistRoutes);
  app.use("/api/auth", appAuthRoutes);
  app.use("/api/users", appUserRoutes);

  // 404 Handler
  app.use((req: Request, _res: Response, next: NextFunction) => {
    next(new NotFoundError(`Route not found: ${req.method} ${req.originalUrl}`));
  });

  // Centralized Error Handler
  app.use(errorHandler);

  return app;
}
