/**
 * Path and Error Sanitization Utilities
 *
 * Provides functions to sanitize sensitive information from paths and error messages
 * before returning them to clients. This prevents exposing:
 * - Usernames (from /Users/<username>/ or /home/<username>/)
 * - Machine-specific paths
 * - Internal directory structures
 *
 * @module sanitize
 */

import { homedir } from "os";

/**
 * Cached home directory for performance
 */
const HOME_DIR = homedir();

/**
 * Patterns that match user home directories across platforms
 */
const HOME_PATTERNS = [
  // macOS: /Users/<username>/...
  /\/Users\/[^/]+/g,
  // Linux: /home/<username>/...
  /\/home\/[^/]+/g,
  // Windows: C:\Users\<username>\... (forward slash normalized)
  /[A-Z]:\\Users\\[^\\]+/gi,
  /[A-Z]:\/Users\/[^/]+/gi,
];

/**
 * Sanitize a file path by replacing home directory with ~
 *
 * @param filePath - The path to sanitize
 * @returns Sanitized path with home directory replaced by ~
 *
 * @example
 * sanitizePath("/Users/john/project/file.ts")
 * // Returns: "~/project/file.ts"
 *
 * sanitizePath("/home/jane/dev/app.js")
 * // Returns: "~/dev/app.js"
 */
export function sanitizePath(filePath: string): string {
  if (!filePath) return filePath;

  let sanitized = filePath;

  // First, replace the actual home directory (most specific match)
  if (HOME_DIR && sanitized.includes(HOME_DIR)) {
    sanitized = sanitized.replace(HOME_DIR, "~");
  }

  // Then apply generic patterns to catch any remaining user paths
  for (const pattern of HOME_PATTERNS) {
    sanitized = sanitized.replace(pattern, "~");
  }

  return sanitized;
}

/**
 * Sanitize an error message by removing sensitive path information
 *
 * Applies path sanitization to any paths found in the message,
 * and removes other potentially sensitive information.
 *
 * @param message - The error message to sanitize
 * @returns Sanitized error message
 *
 * @example
 * sanitizeErrorMessage("File not found: /Users/john/project/secret.ts")
 * // Returns: "File not found: ~/project/secret.ts"
 */
export function sanitizeErrorMessage(message: string): string {
  if (!message) return message;

  let sanitized = message;

  // Sanitize paths
  sanitized = sanitizePath(sanitized);

  // Remove any remaining absolute paths that might have slipped through
  // This catches paths like /var/folders/... (macOS temp) or /tmp/...
  // but preserves the filename for debugging
  sanitized = sanitized.replace(/\/(?:var|tmp|private)[^:\s]*/g, (match) => {
    const parts = match.split("/");
    return `<temp>/${parts[parts.length - 1]}`;
  });

  return sanitized;
}

/**
 * Sanitize an Error object, returning a safe message string
 *
 * Extracts the message from various error types and sanitizes it.
 *
 * @param error - The error to sanitize (Error, string, or unknown)
 * @returns Sanitized error message string
 *
 * @example
 * try {
 *   // some operation
 * } catch (error) {
 *   const safeMessage = sanitizeError(error);
 *   return { success: false, error: { code: "ERROR", message: safeMessage } };
 * }
 */
export function sanitizeError(error: unknown): string {
  if (error instanceof Error) {
    return sanitizeErrorMessage(error.message);
  }
  if (typeof error === "string") {
    return sanitizeErrorMessage(error);
  }
  return sanitizeErrorMessage(String(error));
}

/**
 * Create a sanitized error response object
 *
 * Convenience function for creating standardized error responses
 * with sanitized messages.
 *
 * @param code - Error code (e.g., "FILE_NOT_FOUND")
 * @param error - The original error
 * @param duration - Operation duration in ms
 * @returns Sanitized error response object
 *
 * @example
 * catch (error) {
 *   return createSanitizedErrorResponse("FILE_READ_ERROR", error, Date.now() - startTime);
 * }
 */
export function createSanitizedErrorResponse(
  code: string,
  error: unknown,
  duration: number
): {
  success: false;
  error: { code: string; message: string };
  metadata: { tokensUsed: number; duration: number };
} {
  return {
    success: false,
    error: {
      code,
      message: sanitizeError(error),
    },
    metadata: {
      tokensUsed: 0,
      duration,
    },
  };
}

// ============================================================================
// Sensitive Data Detection Patterns
// ============================================================================

/**
 * Patterns for detecting API keys in string values
 * These are conservative patterns to avoid false positives
 */
const API_KEY_PATTERNS = [
  // OpenAI style: sk-... followed by alphanumeric (at least 20 chars)
  /^sk-[a-zA-Z0-9]{20,}$/,
  // Anthropic style: sk-ant-... with hyphens allowed (e.g., sk-ant-api03-...)
  /^sk-ant-[a-zA-Z0-9-]{20,}$/,
  // Generic sk- prefix with mixed alphanumeric and hyphens (40+ total length for safety)
  /^sk-[a-zA-Z0-9-]{38,}$/,
  // Other provider prefixes: pk-, key-, api-, live-, test-
  /^(pk|key|api|live|test)[-_][a-zA-Z0-9]{16,}$/i,
  // UUID-style keys (with or without hyphens)
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,
  // Generic hex keys (32+ chars, common for API keys)
  /^[a-f0-9]{32,}$/i,
];

/**
 * Field names that indicate sensitive data
 * Includes variations with underscores, hyphens, and camelCase
 */
const SENSITIVE_FIELD_NAMES = [
  "apiKey",
  "api_key",
  "api-key",
  "apikey",
  "x-api-key",
  "secret",
  "password",
  "token",
  "auth",
  "authorization",
  "bearer",
  "credential",
  "credentials",
  "private_key",
  "private-key",
  "privateKey",
  "access_token",
  "access-token",
  "accessToken",
  "refresh_token",
  "refresh-token",
  "refreshToken",
  "client_secret",
  "client-secret",
  "clientSecret",
];

/**
 * Pre-computed lowercase field names for O(1) exact lookup
 */
const SENSITIVE_FIELD_NAMES_LOWER = new Set(
  SENSITIVE_FIELD_NAMES.map((name) => name.toLowerCase())
);

/**
 * Pre-compiled regex for substring matching (O(1) instead of O(n) loop)
 * Escapes special regex characters and joins all patterns with |
 */
const SENSITIVE_FIELD_REGEX = new RegExp(
  Array.from(SENSITIVE_FIELD_NAMES_LOWER)
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|"),
  "i"
);

/**
 * Maximum recursion depth for sanitization to prevent stack overflow
 * on deeply nested or circular objects. Matches AuditWriter.ts.
 */
const MAX_SANITIZATION_DEPTH = 10;

/**
 * Check if a field name indicates sensitive data
 *
 * Uses substring matching to catch variations like "userPassword" or "apiKeySecret"
 *
 * @param fieldName - The field name to check
 * @returns True if the field name indicates sensitive data
 *
 * @example
 * isSensitiveFieldName("password")     // true
 * isSensitiveFieldName("userPassword") // true
 * isSensitiveFieldName("api_key")      // true
 * isSensitiveFieldName("username")     // false
 */
export function isSensitiveFieldName(fieldName: string): boolean {
  const lowerName = fieldName.toLowerCase();
  // Fast path: exact match using Set (O(1) lookup)
  if (SENSITIVE_FIELD_NAMES_LOWER.has(lowerName)) {
    return true;
  }
  // Regex match for substrings (O(1) vs O(n) loop)
  return SENSITIVE_FIELD_REGEX.test(lowerName);
}

/**
 * Check if a string value looks like an API key or secret
 */
function looksLikeApiKey(value: string): boolean {
  return API_KEY_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * Check if a string looks like a file path that should be sanitized
 */
function looksLikePath(value: string): boolean {
  // Check for Unix paths
  if (value.startsWith("/") && value.length > 1) {
    return true;
  }
  // Check for home-relative paths
  if (value.startsWith("~")) {
    return true;
  }
  // Check for Windows paths
  if (/^[A-Z]:[/\\]/i.test(value)) {
    return true;
  }
  return false;
}

/**
 * Sanitize an object recursively, redacting sensitive fields and sanitizing paths
 *
 * This function is designed for audit logging and ensures no sensitive data
 * (API keys, tokens, passwords, user paths) appears in logs.
 *
 * @param obj - The object to sanitize
 * @returns A deeply cloned object with sensitive data redacted
 *
 * @example
 * const sanitized = sanitizeForLogging({
 *   apiKey: "sk-1234567890abcdefghijklmnop",
 *   projectPath: "/Users/john/projects/test",
 *   config: { password: "secret123" }
 * });
 * // Returns:
 * // {
 * //   apiKey: "[REDACTED]",
 * //   projectPath: "~/projects/test",
 * //   config: { password: "[REDACTED]" }
 * // }
 */
export function sanitizeForLogging<T>(obj: T): T {
  return sanitizeValue(obj) as T;
}

/**
 * Internal recursive sanitization helper
 *
 * @param value - The value to sanitize
 * @param _fieldName - Optional field name for context (unused currently)
 * @param depth - Current recursion depth (default 0)
 */
function sanitizeValue(
  value: unknown,
  _fieldName?: string,
  depth: number = 0
): unknown {
  // Prevent stack overflow on deeply nested or circular objects
  if (depth >= MAX_SANITIZATION_DEPTH) {
    return "[MAX_DEPTH]";
  }

  // Handle null/undefined
  if (value === null || value === undefined) {
    return value;
  }

  // Handle strings
  if (typeof value === "string") {
    // Check if value looks like an API key
    if (looksLikeApiKey(value)) {
      return "[REDACTED_API_KEY]";
    }
    // Check if value looks like a path
    if (looksLikePath(value)) {
      return sanitizePath(value);
    }
    return value;
  }

  // Handle arrays
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, undefined, depth + 1));
  }

  // Handle objects
  if (typeof value === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      // Check if the field name indicates sensitive data
      if (isSensitiveFieldName(key)) {
        sanitized[key] = "[REDACTED]";
      } else {
        sanitized[key] = sanitizeValue(val, key, depth + 1);
      }
    }
    return sanitized;
  }

  // For primitives (number, boolean, etc.), return as-is
  return value;
}
