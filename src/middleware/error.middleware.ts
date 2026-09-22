import { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/errors";
import { logger } from "../utils/logger";
import { env } from "../config/env";

export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  let statusCode = 500;
  let code = "INTERNAL_ERROR";
  let message = "An unexpected internal server error occurred";
  let details: unknown = undefined;

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    code = err.code;
    message = err.message;
    details = err.details;
  } else if (err.name === "CastError") {
    statusCode = 400;
    code = "INVALID_REQUEST";
    message = "Invalid identifier format";
  } else if (err.name === "ValidationError") {
    statusCode = 400;
    code = "VALIDATION_ERROR";
    message = err.message;
  }

  // Structured logger log omitting secrets
  logger.error(
    {
      err: {
        name: err.name,
        message: err.message,
        stack: env.NODE_ENV === "development" ? err.stack : undefined
      },
      code,
      statusCode,
      path: req.path,
      method: req.method,
      ip: req.ip
    },
    "Request error handled"
  );

  // Client response: NEVER expose internal stack trace or raw AWS/DB errors
  res.status(statusCode).json({
    success: false,
    message,
    code,
    ...(details !== undefined ? { details } : {})
  });
};
