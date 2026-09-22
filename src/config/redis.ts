import Redis from "ioredis";
import { env } from "./env";
import { logger } from "../utils/logger";

export const redisConnection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  retryStrategy(times) {
    const delay = Math.min(times * 200, 2000);
    return delay;
  }
});

redisConnection.on("connect", () => {
  logger.info("Redis connected successfully");
});

redisConnection.on("error", (err) => {
  logger.error({ err }, "Redis connection error");
});
