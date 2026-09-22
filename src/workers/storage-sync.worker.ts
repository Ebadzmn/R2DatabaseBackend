import { Worker, Job } from "bullmq";
import { redisConnection } from "../config/redis";
import { STORAGE_SYNC_QUEUE_NAME, StorageSyncJobData } from "../modules/processing/processing.queue";
import { StorageManagerService } from "../services/storage-manager.service";
import { logger } from "../utils/logger";

export const storageSyncWorker = new Worker<StorageSyncJobData>(
  STORAGE_SYNC_QUEUE_NAME,
  async (job: Job<StorageSyncJobData>) => {
    logger.info({ jobId: job.id, storageId: job.data.storageAccountId }, "Starting storage sync job");
    await StorageManagerService.recalculateStorageUsage(job.data.storageAccountId);
  },
  {
    connection: redisConnection,
    concurrency: 1
  }
);

storageSyncWorker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, err }, "Storage sync job failed");
});
