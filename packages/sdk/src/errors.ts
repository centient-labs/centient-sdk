/**
 * Custom error classes for Engram SDK
 */

import type { ApiError, ErrorCode, ValidationError } from "./types.js";

/**
 * Base error class for all Engram SDK errors
 */
export class EngramError extends Error {
  /** Raw error details from the API response, if any. */
  public readonly details?: unknown;

  constructor(
    message: string,
    public readonly code: ErrorCode | "NETWORK_ERROR" | "TIMEOUT",
    public readonly statusCode?: number,
    details?: unknown,
  ) {
    super(message);
    this.name = "EngramError";
    this.details = details;
    Object.setPrototypeOf(this, EngramError.prototype);
  }
}

/**
 * Error thrown when a resource is not found (404)
 */
export class NotFoundError extends EngramError {
  constructor(message: string) {
    super(message, "NOT_FOUND", 404);
    this.name = "NotFoundError";
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

/**
 * Error thrown when a session already exists (409)
 */
export class SessionExistsError extends EngramError {
  constructor(sessionId: string) {
    super(`Session ${sessionId} already exists`, "SESSION_EXISTS", 409);
    this.name = "SessionExistsError";
    Object.setPrototypeOf(this, SessionExistsError.prototype);
  }
}

/**
 * Error thrown when request validation fails (400)
 */
export class ValidationFailedError extends EngramError {
  public readonly issues: Array<{
    code: string;
    message: string;
    path: string[];
  }>;

  constructor(validationError: ValidationError["error"]) {
    const message = validationError.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    super(message, "VALIDATION_ERROR", 400);
    this.name = "ValidationFailedError";
    this.issues = validationError.issues;
    Object.setPrototypeOf(this, ValidationFailedError.prototype);
  }
}

/**
 * Error thrown when authentication fails (401)
 */
export class UnauthorizedError extends EngramError {
  constructor(message = "Unauthorized - invalid or missing API key") {
    super(message, "UNAUTHORIZED", 401);
    this.name = "UnauthorizedError";
    Object.setPrototypeOf(this, UnauthorizedError.prototype);
  }
}

/**
 * Error thrown when a network request fails
 */
export class NetworkError extends EngramError {
  public readonly originalError?: Error;

  constructor(message: string, originalError?: Error) {
    super(message, "NETWORK_ERROR");
    this.name = "NetworkError";
    this.originalError = originalError;
    Object.setPrototypeOf(this, NetworkError.prototype);
  }
}

/**
 * Error thrown when a request times out
 */
export class TimeoutError extends EngramError {
  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`, "TIMEOUT");
    this.name = "TimeoutError";
    Object.setPrototypeOf(this, TimeoutError.prototype);
  }
}

/**
 * Error thrown for internal server errors (500)
 */
export class InternalError extends EngramError {
  constructor(message: string) {
    super(message, "INTERNAL_ERROR", 500);
    this.name = "InternalError";
    Object.setPrototypeOf(this, InternalError.prototype);
  }
}

/**
 * Parse an API error response and throw the appropriate error
 */
export function parseApiError(
  statusCode: number,
  body: ApiError | ValidationError | unknown,
): never {
  // Handle validation errors with { success: false, error: { name: "ZodError", ... } }
  if (
    typeof body === "object" &&
    body !== null &&
    "success" in body &&
    body.success === false &&
    "error" in body
  ) {
    const validationBody = body as ValidationError;
    if (validationBody.error.name === "ZodError") {
      throw new ValidationFailedError(validationBody.error);
    }
  }

  // Handle nested error format: { error: { code, message, details? } }
  // This is returned by Hono's zod-validator for query/body validation errors
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof (body as { error: unknown }).error === "object" &&
    (body as { error: { code?: string } }).error !== null
  ) {
    const nestedError = (body as { error: { code?: string; message?: string; details?: unknown } }).error;
    if (nestedError.code && nestedError.message) {
      // Extract validation details if present
      const details = nestedError.details;
      let message = nestedError.message;
      if (details && typeof details === "object" && "issues" in details) {
        const issues = (details as { issues: Array<{ path: string[]; message: string }> }).issues;
        if (Array.isArray(issues) && issues.length > 0) {
          message = issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ");
        }
      }
      throw new EngramError(message, nestedError.code as ErrorCode, statusCode, nestedError.details);
    }
  }

  // Handle standard API errors: { code, message }
  if (typeof body === "object" && body !== null && "code" in body && "message" in body) {
    const apiError = body as ApiError;

    switch (statusCode) {
      case 401:
        throw new UnauthorizedError(apiError.message);
      case 404:
        throw new NotFoundError(apiError.message);
      case 409:
        throw new SessionExistsError(apiError.message);
      case 500:
        throw new InternalError(apiError.message);
      default:
        throw new EngramError(apiError.message, apiError.code, statusCode);
    }
  }

  // Fallback for unknown error format
  throw new EngramError(
    typeof body === "string" ? body : "Unknown error",
    "INTERNAL_ERROR",
    statusCode,
  );
}
