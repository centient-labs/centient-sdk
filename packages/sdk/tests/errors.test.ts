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
  CrystalVersionConflictError,
  ValidationFailedError,
  UnauthorizedError,
  NetworkError,
  TimeoutError,
  InternalError,
  ResponseShapeError,
  ShimmerCasConflictError,
  ShimmerDisabledError,
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

  describe("ResponseShapeError", () => {
    it("should extend EngramError", () => {
      const error = new ResponseShapeError("bad shape", "GET /v1/x", "x");
      expect(error).toBeInstanceOf(EngramError);
      expect(error).toBeInstanceOf(ResponseShapeError);
    });

    it("should carry path + resource and INTERNAL_ERROR code with no statusCode", () => {
      const error = new ResponseShapeError("bad shape", "GET /v1/x", "x-res");
      expect(error.name).toBe("ResponseShapeError");
      expect(error.path).toBe("GET /v1/x");
      expect(error.resource).toBe("x-res");
      expect(error.code).toBe("INTERNAL_ERROR");
      // No statusCode → never re-enters the 5xx retry path (non-retryable).
      expect(error.statusCode).toBeUndefined();
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

  describe("CrystalVersionConflictError", () => {
    it("should extend EngramError", () => {
      const error = new CrystalVersionConflictError("expected 7, got 8", 8);
      expect(error).toBeInstanceOf(EngramError);
      expect(error).toBeInstanceOf(CrystalVersionConflictError);
    });

    it("should have OPERATION_VERSION_CONFLICT code and 409 status", () => {
      const error = new CrystalVersionConflictError("mismatch", 42);
      expect(error.code).toBe("OPERATION_VERSION_CONFLICT");
      expect(error.statusCode).toBe(409);
    });

    it("should expose currentVersion for retry", () => {
      const error = new CrystalVersionConflictError("mismatch", 42);
      expect(error.currentVersion).toBe(42);
    });

    it("should have correct name for instanceof + stringify", () => {
      const error = new CrystalVersionConflictError("mismatch", 1);
      expect(error.name).toBe("CrystalVersionConflictError");
    });

    it("should preserve raw details", () => {
      const body = { code: "OPERATION_VERSION_CONFLICT", message: "m", currentVersion: 99 };
      const error = new CrystalVersionConflictError("m", 99, body);
      expect(error.details).toBe(body);
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

  it("should throw CrystalVersionConflictError for 409 with OPERATION_VERSION_CONFLICT code", () => {
    expect(() =>
      parseApiError(409, {
        code: "OPERATION_VERSION_CONFLICT",
        message: "expected version 7, got 8",
        currentVersion: 8,
      }),
    ).toThrow(CrystalVersionConflictError);
  });

  it("should expose currentVersion on CrystalVersionConflictError thrown from parseApiError", () => {
    try {
      parseApiError(409, {
        code: "OPERATION_VERSION_CONFLICT",
        message: "expected version 7, got 8",
        currentVersion: 8,
      });
      expect.fail("parseApiError should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CrystalVersionConflictError);
      expect((err as CrystalVersionConflictError).currentVersion).toBe(8);
    }
  });

  it("should surface NaN currentVersion when server omits the field", () => {
    // Defense against older servers or malformed bodies — caller sees NaN
    // rather than a silently-zeroed version.
    try {
      parseApiError(409, {
        code: "OPERATION_VERSION_CONFLICT",
        message: "conflict",
      });
      expect.fail("parseApiError should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CrystalVersionConflictError);
      expect(Number.isNaN((err as CrystalVersionConflictError).currentVersion)).toBe(true);
    }
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

  // Regression for #117: the nested `{ error: { code, message } }` Hono
  // envelope must route through the SAME status→class mapping as the flat
  // `{ code, message }` body. Before the fix every nested code other than the
  // two shimmer special-cases threw a base EngramError, so a 404 nested
  // envelope (engram's "no live shimmer") was misclassified.
  describe("nested error envelope { error: { code, message } } (#117)", () => {
    it("should throw NotFoundError for a nested-envelope 404", () => {
      try {
        parseApiError(404, {
          error: { code: "RES_NOT_FOUND", message: "No live shimmer for this (recordType, key)" },
        });
        expect.fail("parseApiError should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(NotFoundError);
        expect((err as NotFoundError).statusCode).toBe(404);
        // The server's original code survives — the thrown CLASS is keyed off
        // the HTTP status, but the `code` is preserved (not flattened to
        // NOT_FOUND), so consumers reading `.code` still see RES_NOT_FOUND.
        expect((err as NotFoundError).code).toBe("RES_NOT_FOUND");
      }
    });

    it("should throw UnauthorizedError for a nested-envelope 401", () => {
      expect(() =>
        parseApiError(401, { error: { code: "UNAUTHORIZED", message: "nope" } }),
      ).toThrow(UnauthorizedError);
    });

    it("should throw CrystalVersionConflictError for a nested-envelope 409 OPERATION_VERSION_CONFLICT", () => {
      try {
        parseApiError(409, {
          error: { code: "OPERATION_VERSION_CONFLICT", message: "expected 7, got 8" },
          currentVersion: 8,
        });
        expect.fail("parseApiError should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(CrystalVersionConflictError);
        expect((err as CrystalVersionConflictError).currentVersion).toBe(8);
      }
    });

    it("should throw SessionExistsError for a nested-envelope 409 (generic)", () => {
      expect(() =>
        parseApiError(409, { error: { code: "SESSION_EXISTS", message: "exists" } }),
      ).toThrow(SessionExistsError);
    });

    it("should throw InternalError for a nested-envelope 500", () => {
      expect(() =>
        parseApiError(500, { error: { code: "INTERNAL_ERROR", message: "boom" } }),
      ).toThrow(InternalError);
    });

    it("should throw EngramError for a nested-envelope unmapped status", () => {
      expect(() =>
        parseApiError(418, { error: { code: "TEAPOT", message: "short and stout" } }),
      ).toThrow(EngramError);
    });

    it("should still map SHIMMER_CAS_CONFLICT from the nested envelope", () => {
      expect(() =>
        parseApiError(409, { error: { code: "SHIMMER_CAS_CONFLICT", message: "held" } }),
      ).toThrow(ShimmerCasConflictError);
    });

    it("should still map SHIMMER_DISABLED from the nested envelope", () => {
      expect(() =>
        parseApiError(503, { error: { code: "SHIMMER_DISABLED", message: "off" } }),
      ).toThrow(ShimmerDisabledError);
    });
  });
});
