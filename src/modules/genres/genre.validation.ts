import { z } from "zod";

export const createGenreSchema = z.object({
  body: z.object({
    name: z.string().min(1, "Genre name is required").trim(),
    slug: z.string().trim().optional(),
    icon: z.string().trim().default("film"),
    gradientStart: z.string().trim().optional(),
    gradientEnd: z.string().trim().optional(),
    description: z.string().trim().optional(),
    order: z.union([z.number(), z.string()]).optional().transform((val) => {
      if (val === undefined || val === null || val === "") return 0;
      const num = Number(val);
      return isNaN(num) ? 0 : num;
    }),
    isActive: z.boolean().default(true)
  })
});

export const updateGenreSchema = z.object({
  params: z.object({
    id: z.string().min(1, "Genre ID is required")
  }),
  body: z.object({
    name: z.string().min(1).trim().optional(),
    slug: z.string().trim().optional(),
    icon: z.string().trim().optional(),
    gradientStart: z.string().trim().optional(),
    gradientEnd: z.string().trim().optional(),
    description: z.string().trim().optional(),
    order: z.union([z.number(), z.string()]).optional().transform((val) => {
      if (val === undefined || val === null || val === "") return undefined;
      const num = Number(val);
      return isNaN(num) ? undefined : num;
    }),
    isActive: z.boolean().optional()
  })
});

export type CreateGenreInput = z.infer<typeof createGenreSchema>["body"];
export type UpdateGenreInput = z.infer<typeof updateGenreSchema>["body"];
