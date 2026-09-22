import { z } from "zod";

export const initUploadSchema = z.object({
  body: z.object({
    fileName: z.string().min(1, "File name is required"),
    fileSize: z.number().positive("File size must be greater than 0"),
    contentType: z.string().default("video/mp4"),
    movieId: z.string().optional(),
    partCount: z.number().int().positive().optional()
  })
});

export const getPartUrlsSchema = z.object({
  params: z.object({
    id: z.string()
  }),
  query: z.object({
    startPart: z.string().transform(Number).default("1"),
    count: z.string().transform(Number).default("10")
  })
});

export const completeUploadSchema = z.object({
  params: z.object({
    id: z.string()
  }),
  body: z.object({
    parts: z
      .array(
        z.object({
          PartNumber: z.number().int().positive(),
          ETag: z.string().min(1)
        })
      )
      .optional()
  })
});

export const abortUploadSchema = z.object({
  params: z.object({
    id: z.string()
  })
});

export type InitUploadInput = z.infer<typeof initUploadSchema>["body"];
export type CompleteUploadInput = z.infer<typeof completeUploadSchema>["body"];
