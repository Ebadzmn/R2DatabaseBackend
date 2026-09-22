import mongoose from "mongoose";
import { env } from "./env";
import { logger } from "../utils/logger";

export async function connectDatabase(): Promise<typeof mongoose> {
  try {
    mongoose.set("strictQuery", true);
    const conn = await mongoose.connect(env.MONGODB_URI);
    logger.info({ host: conn.connection.host, db: conn.connection.name }, "MongoDB connected successfully");
    return conn;
  } catch (error) {
    logger.error({ err: error }, "MongoDB connection failed");
    throw error;
  }
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
  logger.info("MongoDB disconnected");
}
