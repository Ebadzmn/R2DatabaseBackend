import { createApp } from "./app";
import { connectDatabase, disconnectDatabase } from "./config/database";
import { AuthService } from "./modules/auth/auth.service";
import { env } from "./config/env";
import { logger } from "./utils/logger";

import os from "os";
import mongoose from "mongoose";

function getLocalIpAddresses(): string[] {
  const interfaces = os.networkInterfaces();
  const addresses: string[] = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === "IPv4" && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}

async function bootstrap() {
  try {
    // 1. Connect to MongoDB
    await connectDatabase();

    // 2. Seed default admin if database is empty
    await AuthService.seedInitialAdmin();

    // 3. Create Express app
    const app = createApp();

    // 4. Start HTTP server
    const server = app.listen(env.PORT, () => {
      const localIps = getLocalIpAddresses();
      const networkUrl = localIps.length > 0 ? `http://${localIps[0]}:${env.PORT}` : "N/A";
      const dbInfo = mongoose.connection.host
        ? `${mongoose.connection.host}:${mongoose.connection.port}/${mongoose.connection.name}`
        : env.MONGODB_URI;

      console.log(`
================================================================================
🚀 MOVIE UPLOAD & STREAMING BACKEND STARTED
================================================================================
  🌐 Local URL:        http://localhost:${env.PORT}
  📡 Network/LAN IP:   ${networkUrl}
  🔌 Server Port:      ${env.PORT}
  🗄️  Database (Mongo): ${dbInfo}
  ⚡ Queue (Redis):    ${env.REDIS_URL}
  📖 Swagger Docs:     http://localhost:${env.PORT}/api/docs
  🩺 Health Check:     http://localhost:${env.PORT}/api/health
  🎬 Stream Base URL:  ${env.STREAMING_BASE_URL}
  ⚙️  Environment:      ${env.NODE_ENV}
--------------------------------------------------------------------------------
  🔑 Default Admin Login:
     Email:    ${env.INITIAL_ADMIN_EMAIL}
     Password: ${env.INITIAL_ADMIN_PASSWORD}
================================================================================
      `);
    });

    // 5. Graceful shutdown
    const gracefulShutdown = async (signal: string) => {
      logger.info({ signal }, "Received shutdown signal. Closing server...");
      server.close(async () => {
        logger.info("HTTP server closed.");
        await disconnectDatabase();
        logger.info("Process terminated gracefully.");
        process.exit(0);
      });
    };

    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  } catch (error) {
    logger.error({ err: error }, "Failed to bootstrap server");
    process.exit(1);
  }
}

bootstrap();
