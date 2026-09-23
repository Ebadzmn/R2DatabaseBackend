import { z } from "zod";

export const createMovieSchema = z.object({
  body: z.object({
    title: z.string().min(1, "Title is required"),
    description: z.string().optional(),
    poster: z.string().url().optional().or(z.literal("")),
    backdrop: z.string().url().optional().or(z.literal("")),
    type: z.enum(["MOVIE", "SERIES"]).default("MOVIE"),
    releaseYear: z.number().int().min(1888).max(2100).optional(),
    genres: z.array(z.string()).default([]),
    duration: z.number().optional(),
    rating: z.number().optional(),
    director: z.string().optional(),
    trailerUrl: z.string().url().optional().or(z.literal("")),
    tmdbId: z.number().optional(),
    cast: z
      .array(
        z.object({
          name: z.string(),
          character: z.string().optional(),
          image: z.string().optional()
        })
      )
      .optional()
  })
});

export const updateMovieSchema = z.object({
  params: z.object({
    id: z.string()
  }),
  body: z.object({
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    poster: z.string().url().optional().or(z.literal("")),
    backdrop: z.string().url().optional().or(z.literal("")),
    type: z.enum(["MOVIE", "SERIES"]).optional(),
    releaseYear: z.number().int().min(1888).max(2100).optional(),
    genres: z.array(z.string()).optional(),
    duration: z.number().optional(),
    rating: z.number().optional(),
    director: z.string().optional(),
    trailerUrl: z.string().url().optional().or(z.literal("")),
    tmdbId: z.number().optional(),
    cast: z
      .array(
        z.object({
          name: z.string(),
          character: z.string().optional(),
          image: z.string().optional()
        })
      )
      .optional(),
    totalSeasons: z.number().int().min(1).optional(),
    episodes: z.array(z.any()).optional(),
    status: z.enum(["DRAFT", "UPLOADING", "PROCESSING", "READY", "FAILED"]).optional()
  })
});

export const queryMoviesSchema = z.object({
  query: z.object({
    page: z.string().transform(Number).default("1"),
    limit: z.string().transform(Number).default("10"),
    search: z.string().optional(),
    status: z.enum(["DRAFT", "UPLOADING", "PROCESSING", "READY", "FAILED"]).optional(),
    genre: z.string().optional(),
    year: z.string().transform(Number).optional(),
    sortBy: z.enum(["createdAt", "title", "releaseYear", "duration"]).default("createdAt"),
    sortOrder: z.enum(["asc", "desc"]).default("desc")
  })
});

export type CreateMovieInput = z.infer<typeof createMovieSchema>["body"];
export type UpdateMovieInput = z.infer<typeof updateMovieSchema>["body"];
export type QueryMoviesInput = z.infer<typeof queryMoviesSchema>["query"];
