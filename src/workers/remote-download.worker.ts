import { Worker, Job } from "bullmq";
import { redisConnection } from "../config/redis";
import { REMOTE_DOWNLOAD_QUEUE_NAME, RemoteDownloadJobData } from "../modules/processing/processing.queue";
import { RemoteDownloadService } from "../modules/upload/remote-download.service";
import { logger } from "../utils/logger";

export const remoteDownloadWorker = new Worker<RemoteDownloadJobData>(
  REMOTE_DOWNLOAD_QUEUE_NAME,
  async (job: Job<RemoteDownloadJobData>) => {
    logger.info({ jobId: job.id, sessionId: job.data.sessionId }, "Starting BullMQ remote download worker job");
    await RemoteDownloadService.startBackgroundDownload(job.data.sessionId);
  },
  {
    connection: redisConnection,
    concurrency: 2
  }
);

remoteDownloadWorker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, err }, "Remote download worker job failed");
});
