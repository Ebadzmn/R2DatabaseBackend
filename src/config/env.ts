import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.string().transform(Number).default("5000"),
  MONGODB_URI: z.string().default("mongodb://127.0.0.1:27017/movie_streaming_db"),
  REDIS_URL: z.string().default("redis://127.0.0.1:6379"),
  JWT_SECRET: z.string().default("super_secret_jwt_key_movie_upload_dashboard_2026"),
  JWT_EXPIRES_IN: z.string().default("7d"),
  // AES-256 requires 32 bytes (64 hex characters or 32 raw chars)
  ENCRYPTION_KEY: z
    .string()
    .min(32, "ENCRYPTION_KEY must be at least 32 characters or 64 hex characters")
    .default("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"),
  STREAMING_BASE_URL: z.string().default("http://localhost:5000/stream"),
  INITIAL_ADMIN_EMAIL: z.string().email().default("admin@movieplatform.com"),
  INITIAL_ADMIN_PASSWORD: z.string().min(8).default("AdminSecurePassword123!"),
  INITIAL_ADMIN_NAME: z.string().default("Super Admin"),
  FFMPEG_PATH: z.string().optional(),
  FFPROBE_PATH: z.string().optional(),
  RATE_LIMIT_WINDOW_MS: z.string().transform(Number).default("900000"),
  RATE_LIMIT_MAX: z.string().transform(Number).default("1000"),
  TMDB_API_KEY: z.string().default("aae5cb72f79e10ebd2574fb359a3ee6a"),
  TMDB_READ_ACCESS_TOKEN: z.string().optional()
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("Invalid environment configuration:", parsed.error.format());
  throw new Error("Invalid environment configuration");
}

export const env = parsed.data;
