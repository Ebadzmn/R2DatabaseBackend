import { z } from "zod";

export const recordProgressSchema = z.object({
  body: z.object({
    movieId: z.string().min(1, "Movie ID is required"),
    positionSeconds: z.number().min(0, "Position seconds must be positive"),
    durationSeconds: z.number().min(0, "Duration seconds must be positive"),
    seasonNumber: z.number().int().positive().optional().nullable(),
    episodeNumber: z.number().int().positive().optional().nullable(),
    episodeId: z.string().optional().nullable(),
    episodeTitle: z.string().optional().nullable(),
    action: z.enum(["START", "PAUSE", "HEARTBEAT", "EXIT", "COMPLETED"]).optional().default("HEARTBEAT")
  })
});

export const getProgressQuerySchema = z.object({
  params: z.object({
    movieId: z.string().min(1, "Movie ID is required")
  }),
  query: z.object({
    seasonNumber: z.string().regex(/^\d+$/).transform(Number).optional(),
    episodeNumber: z.string().regex(/^\d+$/).transform(Number).optional()
  }).optional()
});

export const getWatchHistoryQuerySchema = z.object({
  query: z.object({
    page: z.string().regex(/^\d+$/).transform(Number).optional().default("1"),
    limit: z.string().regex(/^\d+$/).transform(Number).optional().default("20"),
    status: z.enum(["ALL", "IN_PROGRESS", "COMPLETED", "NOT_COMPLETED"]).optional().default("ALL")
  }).optional()
});
