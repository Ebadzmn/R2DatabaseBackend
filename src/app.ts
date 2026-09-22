import express, { Express, Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import authRoutes from "./modules/auth/auth.routes";
import storageRoutes from "./modules/storage/storage.routes";
import uploadRoutes from "./modules/upload/upload.routes";
import movieRoutes from "./modules/movies/movie.routes";
import publicMovieRoutes from "./modules/movies/public-movie.routes";
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

  // Mount Application Routes
  app.use("/api/admin/auth", authRoutes);
  app.use("/api/admin/storage", storageRoutes);
  app.use("/api/admin/uploads", uploadRoutes);
  app.use("/api/admin/movies", movieRoutes);
  app.use("/api/movies", publicMovieRoutes);

  // 404 Handler
  app.use((req: Request, _res: Response, next: NextFunction) => {
    next(new NotFoundError(`Route not found: ${req.method} ${req.originalUrl}`));
  });

  // Centralized Error Handler
  app.use(errorHandler);

  return app;
}
