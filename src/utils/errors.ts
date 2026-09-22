export type ErrorCode =
  | "INVALID_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "STORAGE_NOT_FOUND"
  | "STORAGE_CONNECTION_FAILED"
  | "STORAGE_CAPACITY_EXCEEDED"
  | "UPLOAD_NOT_FOUND"
  | "UPLOAD_FAILED"
  | "PROCESSING_FAILED"
  | "MOVIE_NOT_FOUND"
  | "INTERNAL_ERROR"
  | "VALIDATION_ERROR"
  | "CONFLICT";

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode;
  public readonly details?: unknown;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    statusCode = 500,
    code: ErrorCode = "INTERNAL_ERROR",
    details?: unknown
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found", code: ErrorCode = "INVALID_REQUEST") {
    super(message, 404, code);
  }
}

export class BadRequestError extends AppError {
  constructor(message = "Bad request", code: ErrorCode = "INVALID_REQUEST", details?: unknown) {
    super(message, 400, code, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized access", code: ErrorCode = "UNAUTHORIZED") {
    super(message, 401, code);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Access forbidden", code: ErrorCode = "FORBIDDEN") {
    super(message, 403, code);
  }
}

export class StorageCapacityExceededError extends AppError {
  constructor(
    message = "All active storage accounts have reached their configured capacity threshold",
    details?: unknown
  ) {
    super(message, 507, "STORAGE_CAPACITY_EXCEEDED", details);
  }
}
