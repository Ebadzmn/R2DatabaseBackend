import swaggerUi from "swagger-ui-express";
import { Express } from "express";

export const swaggerDocument = {
  openapi: "3.0.3",
  info: {
    title: "Production Movie Streaming & Upload Platform API",
    version: "1.0.0",
    description:
      "Production-ready backend API with Cloudflare R2 multi-storage, direct-to-R2 multipart uploads, BullMQ video processing, and HLS streaming."
  },
  servers: [
    {
      url: "/api",
      description: "API Base URL"
    }
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "Enter your JWT token obtained from /api/admin/auth/login"
      }
    }
  },
  paths: {
    "/admin/auth/login": {
      post: {
        tags: ["Admin Auth"],
        summary: "Admin Login",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "password"],
                properties: {
                  email: { type: "string", example: "admin@movieplatform.com" },
                  password: { type: "string", example: "AdminSecurePassword123!" }
                }
              }
            }
          }
        },
        responses: {
          200: { description: "Successful login with JWT token" },
          401: { description: "Invalid credentials" }
        }
      }
    },
    "/admin/auth/me": {
      get: {
        tags: ["Admin Auth"],
        summary: "Get current admin profile",
        security: [{ BearerAuth: [] }],
        responses: {
          200: { description: "Current admin profile" }
        }
      }
    },
    "/admin/storage": {
      get: {
        tags: ["Storage Management"],
        summary: "List all R2 storage accounts with metrics",
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: "List of storage accounts" } }
      },
      post: {
        tags: ["Storage Management"],
        summary: "Add a new R2 storage account",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name", "accountId", "bucketName", "endpoint", "accessKeyId", "secretAccessKey"],
                properties: {
                  name: { type: "string", example: "R2-01" },
                  accountId: { type: "string", example: "cf_account_12345" },
                  bucketName: { type: "string", example: "movies-bucket-1" },
                  endpoint: { type: "string", example: "https://cf_account_12345.r2.cloudflarestorage.com" },
                  accessKeyId: { type: "string", example: "r2_access_key" },
                  secretAccessKey: { type: "string", example: "r2_secret_key" },
                  maxStorageBytes: { type: "number", example: 10737418240 },
                  priority: { type: "number", example: 1 }
                }
              }
            }
          }
        },
        responses: { 201: { description: "Storage account created" } }
      }
    },
    "/admin/storage/test": {
      post: {
        tags: ["Storage Management"],
        summary: "Test R2 credentials before saving",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["accountId", "bucketName", "endpoint", "accessKeyId", "secretAccessKey"],
                properties: {
                  accountId: { type: "string" },
                  bucketName: { type: "string" },
                  endpoint: { type: "string" },
                  accessKeyId: { type: "string" },
                  secretAccessKey: { type: "string" }
                }
              }
            }
          }
        },
        responses: {
          200: { description: "R2 credentials verified successfully" },
          400: { description: "R2 connection failed" }
        }
      }
    },
    "/admin/storage/{id}/recalculate": {
      post: {
        tags: ["Storage Management"],
        summary: "Recalculate storage usage by querying R2 bucket directly",
        security: [{ BearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Usage recalculated" } }
      }
    },
    "/admin/uploads/init": {
      post: {
        tags: ["Upload Management"],
        summary: "Initialize direct-to-R2 upload with automatic storage selection & reservation",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["fileName", "fileSize"],
                properties: {
                  fileName: { type: "string", example: "movie.mp4" },
                  fileSize: { type: "number", example: 2147483648 },
                  contentType: { type: "string", example: "video/mp4" },
                  movieId: { type: "string" },
                  partCount: { type: "number", example: 10 }
                }
              }
            }
          }
        },
        responses: { 201: { description: "Upload session initialized with presigned URLs" } }
      }
    },
    "/admin/uploads/{id}/complete": {
      post: {
        tags: ["Upload Management"],
        summary: "Complete multipart upload and dispatch BullMQ HLS transcoding",
        security: [{ BearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["parts"],
                properties: {
                  parts: {
                    type: "array",
                    items: {
                      type: "object",
                      required: ["PartNumber", "ETag"],
                      properties: {
                        PartNumber: { type: "number" },
                        ETag: { type: "string" }
                      }
                    }
                  }
                }
              }
            }
          }
        },
        responses: { 200: { description: "Upload completed, processing queued" } }
      }
    },
    "/admin/movies": {
      get: {
        tags: ["Movie Management"],
        summary: "List movies with filters and pagination",
        security: [{ BearerAuth: [] }],
        responses: { 200: { description: "Movie list" } }
      },
      post: {
        tags: ["Movie Management"],
        summary: "Create movie record",
        security: [{ BearerAuth: [] }],
        responses: { 201: { description: "Movie created" } }
      }
    },
    "/api/movies": {
      get: {
        tags: ["Public Movies"],
        summary: "Public movie catalog",
        responses: { 200: { description: "Public movie list" } }
      }
    },
    "/api/movies/{id}/playback": {
      get: {
        tags: ["Public Movies"],
        summary: "Get secure HLS playback URL for Flutter app",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          200: {
            description: "Playback details",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    movieId: { type: "string" },
                    title: { type: "string" },
                    type: { type: "string", example: "HLS" },
                    url: { type: "string", example: "http://localhost:5000/stream/movies/reacher/hls/master.m3u8" }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
};

export function setupSwagger(app: Express): void {
  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));
}
