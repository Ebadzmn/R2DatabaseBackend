import { connectDatabase } from "../config/database";
import { logger } from "../utils/logger";
import { videoProcessingWorker } from "./video-processing.worker";
import { storageSyncWorker } from "./storage-sync.worker";
import { movieDeleteWorker } from "./movie-delete.worker";

async function startWorkers() {
  await connectDatabase();
  logger.info("BullMQ background workers started successfully");

  const shutdown = async () => {
    logger.info("Stopping background workers...");
    await Promise.all([
      videoProcessingWorker.close(),
      storageSyncWorker.close(),
      movieDeleteWorker.close()
    ]);
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (require.main === module) {
  startWorkers().catch((err) => {
    logger.error({ err }, "Failed to start background workers");
    process.exit(1);
  });
}
