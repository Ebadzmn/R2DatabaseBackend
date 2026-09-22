import { Worker, Job } from "bullmq";
import { redisConnection } from "../config/redis";
import {
  VIDEO_PROCESSING_QUEUE_NAME,
  VideoProcessingJobData
} from "../modules/processing/processing.queue";
import { ProcessingService } from "../modules/processing/processing.service";
import { logger } from "../utils/logger";

export const videoProcessingWorker = new Worker<VideoProcessingJobData>(
  VIDEO_PROCESSING_QUEUE_NAME,
  async (job: Job<VideoProcessingJobData>) => {
    logger.info({ jobId: job.id, data: job.data }, "Starting video processing worker job");
    await ProcessingService.processVideo(job.data);
    logger.info({ jobId: job.id }, "Video processing worker job completed successfully");
  },
  {
    connection: redisConnection,
    concurrency: 2 // Max simultaneous transcoding tasks to prevent CPU exhaustion
  }
);

videoProcessingWorker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, err }, "Video processing job failed");
});
