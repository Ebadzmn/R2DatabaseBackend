import { z } from "zod";

export const createMovieSchema = z.object({
  body: z
    .object({
      title: z.string().min(1, "Title is required"),
      description: z.string().nullable().optional(),
      poster: z.string().nullable().optional(),
      backdrop: z.string().nullable().optional(),
      type: z.enum(["MOVIE", "SERIES"]).default("MOVIE"),
      category: z.string().nullable().optional(),
      categoryId: z.string().nullable().optional(),
      releaseYear: z
        .union([z.number(), z.string(), z.null()])
        .optional()
        .transform((val) => {
          if (val === "" || val === null || val === undefined) return undefined;
          const num = Number(val);
          return isNaN(num) ? undefined : num;
        }),
      genres: z.array(z.string()).default([]),
      duration: z
        .union([z.number(), z.string(), z.null()])
        .optional()
        .transform((val) => {
          if (val === "" || val === null || val === undefined) return undefined;
          const num = Number(val);
          return isNaN(num) ? undefined : num;
        }),
      rating: z
        .union([z.number(), z.string(), z.null()])
        .optional()
        .transform((val) => {
          if (val === "" || val === null || val === undefined) return undefined;
          const num = Number(val);
          return isNaN(num) ? undefined : num;
        }),
      director: z.string().nullable().optional(),
      trailerUrl: z.string().nullable().optional(),
      tmdbId: z
        .union([z.number(), z.string(), z.null()])
        .optional()
        .transform((val) => {
          if (val === "" || val === null || val === undefined) return undefined;
          const num = Number(val);
          return isNaN(num) ? undefined : num;
        }),
      screenshots: z.array(z.string()).nullable().optional(),
      cast: z.array(z.any()).nullable().optional(),
      isPinned: z.boolean().optional()
    })
    .passthrough()
});

export const updateMovieSchema = z.object({
  params: z.object({
    id: z.string()
  }),
  body: z
    .object({
      title: z.string().min(1).optional(),
      description: z.string().nullable().optional(),
      poster: z.string().nullable().optional(),
      backdrop: z.string().nullable().optional(),
      type: z.enum(["MOVIE", "SERIES"]).optional(),
      category: z.string().nullable().optional(),
      categoryId: z.string().nullable().optional(),
      releaseYear: z
        .union([z.number(), z.string(), z.null()])
        .optional()
        .transform((val) => {
          if (val === "" || val === null || val === undefined) return undefined;
          const num = Number(val);
          return isNaN(num) ? undefined : num;
        }),
      genres: z.array(z.string()).nullable().optional(),
      duration: z
        .union([z.number(), z.string(), z.null()])
        .optional()
        .transform((val) => {
          if (val === "" || val === null || val === undefined) return undefined;
          const num = Number(val);
          return isNaN(num) ? undefined : num;
        }),
      rating: z
        .union([z.number(), z.string(), z.null()])
        .optional()
        .transform((val) => {
          if (val === "" || val === null || val === undefined) return undefined;
          const num = Number(val);
          return isNaN(num) ? undefined : num;
        }),
      director: z.string().nullable().optional(),
      trailerUrl: z.string().nullable().optional(),
      tmdbId: z
        .union([z.number(), z.string(), z.null()])
        .optional()
        .transform((val) => {
          if (val === "" || val === null || val === undefined) return undefined;
          const num = Number(val);
          return isNaN(num) ? undefined : num;
        }),
      cast: z.array(z.any()).nullable().optional(),
      screenshots: z.array(z.string()).nullable().optional(),
      totalSeasons: z
        .union([z.number(), z.string(), z.null()])
        .optional()
        .transform((val) => {
          if (val === "" || val === null || val === undefined) return undefined;
          const num = Number(val);
          return isNaN(num) ? undefined : num;
        }),
      episodes: z.array(z.any()).nullable().optional(),
      status: z.enum(["DRAFT", "UPLOADING", "PROCESSING", "READY", "FAILED"]).optional(),
      isPinned: z.boolean().optional()
    })
    .passthrough()
});

export const queryMoviesSchema = z.object({
  query: z.object({
    page: z.string().transform(Number).default("1"),
    limit: z.string().transform(Number).default("10"),
    search: z.string().optional(),
    status: z.enum(["DRAFT", "UPLOADING", "PROCESSING", "READY", "FAILED"]).optional(),
    type: z.enum(["MOVIE", "SERIES"]).optional(),
    genre: z.string().optional(),
    category: z.string().optional(),
    year: z.string().transform(Number).optional(),
    sortBy: z.enum(["createdAt", "title", "releaseYear", "duration"]).default("createdAt"),
    sortOrder: z.enum(["asc", "desc"]).default("desc")
  })
});

export type CreateMovieInput = z.infer<typeof createMovieSchema>["body"];
export type UpdateMovieInput = z.infer<typeof updateMovieSchema>["body"];
export type QueryMoviesInput = z.infer<typeof queryMoviesSchema>["query"];
