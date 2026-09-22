import { z } from "zod";

export const testStorageSchema = z.object({
  body: z.object({
    accountId: z.string().min(1, "Cloudflare Account ID is required"),
    bucketName: z.string().min(1, "Bucket name is required"),
    endpoint: z.string().min(1, "Endpoint is required"),
    accessKeyId: z.string().min(1, "Access Key ID is required"),
    secretAccessKey: z.string().min(1, "Secret Access Key is required")
  })
});

export const createStorageSchema = z.object({
  body: z.object({
    name: z.string().min(1, "Storage name is required"),
    accountId: z.string().min(1, "Cloudflare Account ID is required"),
    bucketName: z.string().min(1, "Bucket name is required"),
    endpoint: z.string().min(1, "Endpoint is required"),
    publicUrl: z.string().url().optional().or(z.literal("")),
    accessKeyId: z.string().min(1, "Access Key ID is required"),
    secretAccessKey: z.string().min(1, "Secret Access Key is required"),
    maxStorageBytes: z.number().positive().default(10 * 1024 * 1024 * 1024), // 10 GB
    priority: z.number().int().positive().default(1),
    status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE")
  })
});

export const updateStorageSchema = z.object({
  params: z.object({
    id: z.string()
  }),
  body: z.object({
    name: z.string().min(1).optional(),
    publicUrl: z.string().url().optional().or(z.literal("")),
    maxStorageBytes: z.number().positive().optional(),
    priority: z.number().int().positive().optional(),
    status: z.enum(["ACTIVE", "INACTIVE", "FULL", "ERROR"]).optional(),
    accessKeyId: z.string().optional(),
    secretAccessKey: z.string().optional()
  })
});

export type TestStorageInput = z.infer<typeof testStorageSchema>["body"];
export type CreateStorageInput = z.infer<typeof createStorageSchema>["body"];
export type UpdateStorageInput = z.infer<typeof updateStorageSchema>["body"];
