import { Request, Response, NextFunction } from "express";
import { MovieService } from "./movie.service";
import { Movie } from "./movie.model";
import { StorageAccount } from "../storage/storage.model";
import { R2Service } from "../storage/r2.service";
import { sendSuccess } from "../../utils/response";
import { AuditService } from "../audit/audit.service";

export class MovieController {
  public static async getAll(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await MovieService.getAll(req.query as any);
      sendSuccess(res, result.items, undefined, 200, result.meta);
    } catch (error) {
      next(error);
    }
  }

  public static async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const movie = await MovieService.getById(req.params.id);
      sendSuccess(res, movie);
    } catch (error) {
      next(error);
    }
  }

  public static async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const movie = await MovieService.create(req.body);

      await AuditService.record({
        adminId: req.admin?.adminId,
        action: "MOVIE_CREATED",
        resourceType: "MOVIE",
        resourceId: movie._id.toString(),
        metadata: { title: movie.title, slug: movie.slug },
        ipAddress: req.ip
      });

      sendSuccess(res, movie, "Movie created successfully", 201);
    } catch (error) {
      next(error);
    }
  }

  public static async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const movie = await MovieService.update(req.params.id, req.body);

      await AuditService.record({
        adminId: req.admin?.adminId,
        action: "MOVIE_UPDATED",
        resourceType: "MOVIE",
        resourceId: movie._id.toString(),
        metadata: { title: movie.title },
        ipAddress: req.ip
      });

      sendSuccess(res, movie, "Movie updated successfully");
    } catch (error) {
      next(error);
    }
  }

  public static async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await MovieService.delete(req.params.id);

      await AuditService.record({
        adminId: req.admin?.adminId,
        action: "MOVIE_DELETED",
        resourceType: "MOVIE",
        resourceId: req.params.id,
        ipAddress: req.ip
      });

      sendSuccess(res, null, "Movie deleted successfully");
    } catch (error) {
      next(error);
    }
  }

  public static async process(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await MovieService.process(req.params.id);

      await AuditService.record({
        adminId: req.admin?.adminId,
        action: "MOVIE_PROCESSED",
        resourceType: "MOVIE",
        resourceId: req.params.id,
        ipAddress: req.ip
      });

      sendSuccess(res, result, "Video processing queued");
    } catch (error) {
      next(error);
    }
  }

  public static async reprocess(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await MovieService.process(req.params.id);

      await AuditService.record({
        adminId: req.admin?.adminId,
        action: "MOVIE_REPROCESSED",
        resourceType: "MOVIE",
        resourceId: req.params.id,
        ipAddress: req.ip
      });

      sendSuccess(res, result, "Video reprocessing queued");
    } catch (error) {
      next(error);
    }
  }

  public static async getStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const status = await MovieService.getStatus(req.params.id);
      sendSuccess(res, status);
    } catch (error) {
      next(error);
    }
  }

  public static async addEpisode(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const episode = await MovieService.addEpisode(req.params.id, req.body);
      sendSuccess(res, episode, "Episode added successfully", 201);
    } catch (error) {
      next(error);
    }
  }

  public static async updateEpisode(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const episode = await MovieService.updateEpisode(
        req.params.id,
        req.params.episodeId,
        req.body
      );
      sendSuccess(res, episode, "Episode updated successfully");
    } catch (error) {
      next(error);
    }
  }

  public static async deleteEpisode(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await MovieService.deleteEpisode(req.params.id, req.params.episodeId);
      sendSuccess(res, result, "Episode deleted successfully");
    } catch (error) {
      next(error);
    }
  }

  public static async importTmdbEpisodes(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const movie = await MovieService.importTmdbEpisodes(req.params.id);
      sendSuccess(res, movie, "All seasons and episodes successfully imported from TMDB");
    } catch (error) {
      next(error);
    }
  }

  public static async getEpisodePlayback(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const season = parseInt(req.params.season, 10);
      const episode = parseInt(req.params.episode, 10);
      const playback = await MovieService.getEpisodePlaybackUrl(req.params.id, season, episode);
      sendSuccess(res, playback);
    } catch (error) {
      next(error);
    }
  }

  public static async streamEpisodeHlsProxy(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const movieId = req.params.id;
      const seasonNum = parseInt(req.params.season, 10);
      const epNum = parseInt(req.params.episode, 10);
      const subpath = req.params[0] || "master.m3u8";

      const movie = await Movie.findById(movieId);
      if (!movie) {
        res.status(404).json({ success: false, message: "Series not found" });
        return;
      }

      const ep = movie.episodes.find(
        (e) => e.seasonNumber === seasonNum && e.episodeNumber === epNum
      );

      if (!ep || !ep.hlsMasterKey || !ep.hlsStorageId) {
        res.status(404).json({ success: false, message: "Episode stream not found or not ready" });
        return;
      }

      const storageAccount = await StorageAccount.findById(ep.hlsStorageId);
      if (!storageAccount) {
        res.status(404).json({ success: false, message: "Storage account not found" });
        return;
      }

      const hlsPrefix = ep.hlsMasterKey.replace("/master.m3u8", "");
      const cleanSubpath = subpath.replace(/^\/+/, "");
      const objectKey = `${hlsPrefix}/${cleanSubpath}`;

      try {
        const { stream, contentType, contentLength } = await R2Service.getObjectDetailed(
          storageAccount,
          objectKey
        );

        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "*");

        if (subpath.endsWith(".m3u8")) {
          res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        } else if (subpath.endsWith(".ts")) {
          res.setHeader("Content-Type", "video/mp2t");
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        } else if (contentType) {
          res.setHeader("Content-Type", contentType);
        }

        if (contentLength) {
          res.setHeader("Content-Length", contentLength);
        }

        stream.pipe(res);
      } catch (err: any) {
        if (err?.name === "NoSuchKey" || err?.$metadata?.httpStatusCode === 404) {
          res.status(404).json({ success: false, message: `HLS segment not found: ${objectKey}` });
          return;
        }
        throw err;
      }
    } catch (error) {
      next(error);
    }
  }

  public static async getPlayback(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const playback = await MovieService.getPlaybackUrl(req.params.id);
      sendSuccess(res, playback);
    } catch (error) {
      next(error);
    }
  }

  public static async streamHlsProxy(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const movieId = req.params.id;
      // Extract subpath after /stream/
      const subpath = req.params[0] || "master.m3u8";

      const movie = await Movie.findById(movieId);
      if (!movie || !movie.hlsMasterKey || !movie.hlsStorageId) {
        res.status(404).json({ success: false, message: "Stream not found or movie not ready" });
        return;
      }

      const storageAccount = await StorageAccount.findById(movie.hlsStorageId);
      if (!storageAccount) {
        res.status(404).json({ success: false, message: "Storage account not found" });
        return;
      }

      const hlsPrefix = movie.hlsMasterKey.replace("/master.m3u8", "");
      const cleanSubpath = subpath.replace(/^\/+/, "");
      const objectKey = `${hlsPrefix}/${cleanSubpath}`;

      try {
        const { stream, contentType, contentLength } = await R2Service.getObjectDetailed(
          storageAccount,
          objectKey
        );

        // Set CORS & caching headers for seamless HLS playback
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "*");

        if (subpath.endsWith(".m3u8")) {
          res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        } else if (subpath.endsWith(".ts")) {
          res.setHeader("Content-Type", "video/mp2t");
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        } else if (contentType) {
          res.setHeader("Content-Type", contentType);
        }

        if (contentLength) {
          res.setHeader("Content-Length", contentLength);
        }

        stream.pipe(res);
      } catch (err: any) {
        if (err?.name === "NoSuchKey" || err?.$metadata?.httpStatusCode === 404) {
          res.status(404).json({ success: false, message: `HLS segment or playlist not found: ${objectKey}` });
          return;
        }
        throw err;
      }
    } catch (error) {
      next(error);
    }
  }
}

