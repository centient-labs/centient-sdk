/**
 * Error Classes Tests
 *
 * Tests for SDK error types and parseApiError helper.
 */

import { describe, it, expect } from "vitest";
import {
  EngramError,
  NotFoundError,
  SessionExistsError,
  ValidationFailedError,
  UnauthorizedError,
  NetworkError,
  TimeoutError,
  InternalError,
  parseApiError,
} from "../src/errors.js";

describe("Error Classes", () => {
  describe("EngramError", () => {
    it("should be instance of Error", () => {
      const error = new EngramError("Test error", "TEST_CODE");
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(EngramError);
    });

    it("should have correct properties", () => {
      const error = new EngramError("Test message", "TEST_CODE", 400);
      expect(error.message).toBe("Test message");
      expect(error.code).toBe("TEST_CODE");
      expect(error.statusCode).toBe(400);
    });

    it("should have correct name", () => {
      const error = new EngramError("Test", "CODE");
      expect(error.name).toBe("EngramError");
    });
  });

  describe("NotFoundError", () => {
    it("should extend EngramError", () => {
      const error = new NotFoundError("Resource not found");
      expect(error).toBeInstanceOf(EngramError);
      expect(error).toBeInstanceOf(NotFoundError);
    });

    it("should have NOT_FOUND code", () => {
      const error = new NotFoundError("Session not found");
      expect(error.code).toBe("NOT_FOUND");
      expect(error.statusCode).toBe(404);
    });

    it("should have correct name", () => {
      const error = new NotFoundError("Not found");
      expect(error.name).toBe("NotFoundError");
    });
  });

  describe("SessionExistsError", () => {
    it("should extend EngramError", () => {
      const error = new SessionExistsError("Session already exists");
      expect(error).toBeInstanceOf(EngramError);
    });

    it("should have SESSION_EXISTS code", () => {
      const error = new SessionExistsError("Session exists");
      expect(error.code).toBe("SESSION_EXISTS");
      expect(error.statusCode).toBe(409);
    });

    it("should have correct name", () => {
      const error = new SessionExistsError("Exists");
      expect(error.name).toBe("SessionExistsError");
    });
  });

  describe("ValidationFailedError", () => {
    const validationError = {
      issues: [{ code: "required", message: "Required", path: ["field"] }],
      name: "ZodError" as const,
    };

    it("should extend EngramError", () => {
      const error = new ValidationFailedError(validationError);
      expect(error).toBeInstanceOf(EngramError);
    });

    it("should have VALIDATION_ERROR code", () => {
      const error = new ValidationFailedError(validationError);
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.statusCode).toBe(400);
    });

    it("should store validation issues", () => {
      const error = new ValidationFailedError(validationError);
      expect(error.issues).toEqual(validationError.issues);
    });
  });

  describe("UnauthorizedError", () => {
    it("should extend EngramError", () => {
      const error = new UnauthorizedError("Not authorized");
      expect(error).toBeInstanceOf(EngramError);
    });

    it("should have UNAUTHORIZED code", () => {
      const error = new UnauthorizedError("Unauthorized");
      expect(error.code).toBe("UNAUTHORIZED");
      expect(error.statusCode).toBe(401);
    });
  });

  describe("NetworkError", () => {
    it("should extend EngramError", () => {
      const error = new NetworkError("Connection failed");
      expect(error).toBeInstanceOf(EngramError);
    });

    it("should have NETWORK_ERROR code", () => {
      const error = new NetworkError("Failed");
      expect(error.code).toBe("NETWORK_ERROR");
    });

    it("should store original error", () => {
      const original = new Error("Original error");
      const error = new NetworkError("Network failed", original);
      expect(error.originalError).toBe(original);
    });
  });

  describe("TimeoutError", () => {
    it("should extend EngramError", () => {
      const error = new TimeoutError(5000);
      expect(error).toBeInstanceOf(EngramError);
    });

    it("should have TIMEOUT code", () => {
      const error = new TimeoutError(5000);
      expect(error.code).toBe("TIMEOUT");
    });

    it("should include timeout in message", () => {
      const error = new TimeoutError(5000);
      expect(error.message).toContain("5000");
    });

    it("should have correct name", () => {
      const error = new TimeoutError(3000);
      expect(error.name).toBe("TimeoutError");
    });
  });

  describe("InternalError", () => {
    it("should extend EngramError", () => {
      const error = new InternalError("Server error");
      expect(error).toBeInstanceOf(EngramError);
    });

    it("should have INTERNAL_ERROR code", () => {
      const error = new InternalError("Internal");
      expect(error.code).toBe("INTERNAL_ERROR");
      expect(error.statusCode).toBe(500);
    });
  });
});

describe("parseApiError", () => {
  it("should throw NotFoundError for 404", () => {
    expect(() =>
      parseApiError(404, { code: "NOT_FOUND", message: "Not found" })
    ).toThrow(NotFoundError);
  });

  it("should throw SessionExistsError for 409 with SESSION_EXISTS code", () => {
    expect(() =>
      parseApiError(409, { code: "SESSION_EXISTS", message: "Exists" })
    ).toThrow(SessionExistsError);
  });

  it("should throw EngramError for 400 without ZodError", () => {
    expect(() =>
      parseApiError(400, { code: "VALIDATION_ERROR", message: "Invalid" })
    ).toThrow(EngramError);
  });

  it("should throw UnauthorizedError for 401", () => {
    expect(() =>
      parseApiError(401, { code: "UNAUTHORIZED", message: "Not authorized" })
    ).toThrow(UnauthorizedError);
  });

  it("should throw InternalError for 500", () => {
    expect(() =>
      parseApiError(500, { code: "INTERNAL_ERROR", message: "Server error" })
    ).toThrow(InternalError);
  });

  it("should throw EngramError for other status codes", () => {
    expect(() =>
      parseApiError(418, { code: "TEAPOT", message: "I am a teapot" })
    ).toThrow(EngramError);
  });

  it("should handle Zod validation errors", () => {
    const zodError = {
      success: false,
      error: {
        issues: [
          { code: "required", message: "Required", path: ["field"] },
        ],
        name: "ZodError",
      },
    };

    try {
      parseApiError(400, zodError);
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationFailedError);
      expect((error as ValidationFailedError).issues).toBeDefined();
    }
  });

  it("should handle responses without code", () => {
    expect(() => parseApiError(500, { message: "Something went wrong" })).toThrow(
      EngramError
    );
  });
});
