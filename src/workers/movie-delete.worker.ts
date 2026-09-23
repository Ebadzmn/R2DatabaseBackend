import { Worker, Job } from "bullmq";
import { redisConnection } from "../config/redis";
import { MOVIE_DELETE_QUEUE_NAME, MovieDeleteJobData } from "../modules/processing/processing.queue";
import { StorageAccount } from "../modules/storage/storage.model";
import { Movie } from "../modules/movies/movie.model";
import { R2Service } from "../modules/storage/r2.service";
import { StorageManagerService } from "../services/storage-manager.service";
import { logger } from "../utils/logger";

export const movieDeleteWorker = new Worker<MovieDeleteJobData>(
  MOVIE_DELETE_QUEUE_NAME,
  async (job: Job<MovieDeleteJobData>) => {
    const { movieId, storageAccountId, hlsPrefix, sourceKey } = job.data;
    logger.info({ movieId, hlsPrefix }, "Starting background deletion of movie assets from R2");

    const storageAccount = await StorageAccount.findById(storageAccountId);
    if (!storageAccount) {
      logger.warn({ storageAccountId }, "Storage account not found for movie deletion, deleting record only");
      await Movie.findByIdAndDelete(movieId);
      return;
    }

    let freedBytes = 0;

    // 1. Delete HLS directory
    if (hlsPrefix) {
      try {
        const result = await R2Service.deleteDirectory(storageAccount, hlsPrefix);
        freedBytes += result.freedBytes;
        logger.info({ movieId, deletedCount: result.deletedCount, freedBytes: result.freedBytes }, "Deleted HLS segments from R2");
      } catch (err) {
        logger.error({ err, hlsPrefix }, "Failed to delete some HLS segments from R2");
      }
    }

    // 2. Delete source object if exists
    if (sourceKey) {
      try {
        await R2Service.deleteObject(storageAccount, sourceKey);
        logger.info({ movieId, sourceKey }, "Deleted source video object from R2");
      } catch (err) {
        logger.error({ err, sourceKey }, "Failed to delete source video object from R2");
      }
    }

    // 3. Update storage usage in account with real-time recalculation from R2
    try {
      await StorageManagerService.recalculateStorageUsage(storageAccount._id);
    } catch (recalcErr) {
      logger.warn({ err: recalcErr, storageAccountId }, "Failed to recalculate R2 storage in delete worker");
    }

    // 4. Delete MongoDB record
    await Movie.findByIdAndDelete(movieId);
    logger.info({ movieId, freedBytes }, "Movie assets deleted and MongoDB record removed");
  },
  {
    connection: redisConnection,
    concurrency: 2
  }
);

movieDeleteWorker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, err }, "Movie deletion job failed");
});
