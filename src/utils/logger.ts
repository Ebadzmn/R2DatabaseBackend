import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

export const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? "debug" : "info"),
  redact: {
    paths: [
      "secretAccessKey",
      "accessKeyId",
      "password",
      "passwordHash",
      "authorization",
      "token",
      "req.headers.authorization",
      "req.headers['x-api-key']",
      "encryptionKey",
      "jwtSecret"
    ],
    censor: "[REDACTED]"
  },
  transport: isDev
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname"
        }
      }
    : undefined
});
