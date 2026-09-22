import { Queue } from "bullmq";
import { redisConnection } from "../../config/redis";
import { logger } from "../../utils/logger";

export const VIDEO_PROCESSING_QUEUE_NAME = "video-processing";
export const STORAGE_SYNC_QUEUE_NAME = "storage-sync";
export const MOVIE_DELETE_QUEUE_NAME = "movie-delete";

export interface VideoProcessingJobData {
  movieId: string;
  uploadSessionId: string;
  storageAccountId: string;
  sourceObjectKey: string;
}

export interface StorageSyncJobData {
  storageAccountId: string;
}

export interface MovieDeleteJobData {
  movieId: string;
  storageAccountId: string;
  hlsPrefix: string;
  sourceKey?: string;
}

// Queue options with standard exponential backoff retry strategy
const defaultJobOptions = {
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 5000
  },
  removeOnComplete: {
    age: 86400, // Keep completed jobs for 24 hours
    count: 1000
  },
  removeOnFail: {
    age: 604800 // Keep failed jobs for 7 days
  }
};

export const videoProcessingQueue = new Queue<VideoProcessingJobData>(
  VIDEO_PROCESSING_QUEUE_NAME,
  {
    connection: redisConnection,
    defaultJobOptions
  }
);

export const storageSyncQueue = new Queue<StorageSyncJobData>(
  STORAGE_SYNC_QUEUE_NAME,
  {
    connection: redisConnection,
    defaultJobOptions
  }
);

export const movieDeleteQueue = new Queue<MovieDeleteJobData>(
  MOVIE_DELETE_QUEUE_NAME,
  {
    connection: redisConnection,
    defaultJobOptions
  }
);

logger.info("BullMQ queues initialized successfully");
