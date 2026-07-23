/**
 * vault-utils — isValidKey
 *
 * Pins the allowed credential key grammar. The regex intentionally
 * permits both `-` and `.` as namespace separators so callers can use
 * either convention (hyphen-delimited `soma-anthropic-token1` or
 * dot-delimited `soma.anthropic.token1`), and deliberately rejects
 * everything else so keys can be interpolated into subprocess argv
 * without escaping.
 */

import { describe, expect, it } from "vitest";
import {
  isValidKey,
  isValidKeyPrefix,
  assertValidKey,
  assertValidKeyPrefix,
} from "../src/vault/vault-utils.js";
import {
  InvalidCredentialKeyError,
  VaultError,
} from "../src/vault/session-vault-errors.js";

describe("isValidKey — accepted shapes", () => {
  it.each([
    "auth-token",
    "refresh-token",
    "a1",
    "ab",
    "soma-anthropic-token1",
    "soma-anthropic-token99",
    "soma.anthropic.token1",
    "soma.anthropic.token99",
    "soma-anthropic.token1",
    "1-2-3",
    "a.b-c.d",
    "x".repeat(64),
  ])("accepts %s", (key) => {
    expect(isValidKey(key)).toBe(true);
  });
});

describe("isValidKey — rejected shapes", () => {
  it.each([
    ["empty string", ""],
    ["single character", "a"],
    ["uppercase", "Auth-Token"],
    ["underscore", "auth_token"],
    ["whitespace", "auth token"],
    ["leading hyphen", "-auth"],
    ["trailing hyphen", "auth-"],
    ["leading dot", ".auth"],
    ["trailing dot", "auth."],
    ["shell metachar $", "auth$token"],
    ["shell metachar ;", "auth;token"],
    ["backslash", "auth\\token"],
    ["forward slash", "auth/token"],
    ["quote", "auth'token"],
    ["65 characters", "x".repeat(65)],
    ["non-ASCII", "auth-tökén"],
  ])("rejects %s", (_label, key) => {
    expect(isValidKey(key)).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// isValidKeyPrefix (#168)
//
// `listCredentials(prefix)` filters by string prefix, so the natural way to
// scope an enumeration to a namespace is to include the separator —
// `listCredentials("soma.anthropic.")`, the documented example. That is not a
// valid KEY, so the prefix relaxes exactly one rule (the trailing character may
// be a separator) and keeps every other constraint.
// -----------------------------------------------------------------------------

describe("isValidKeyPrefix — accepted shapes", () => {
  it.each([
    ["empty means no filter", ""],
    ["a full valid key is also a valid prefix", "auth-token"],
    ["single leading character", "a"],
    ["trailing dot separator", "soma.anthropic."],
    ["trailing hyphen separator", "soma-anthropic-"],
    ["mid-word truncation", "soma.anth"],
    ["64 characters", "x".repeat(64)],
  ])("accepts %s", (_label, prefix) => {
    expect(isValidKeyPrefix(prefix)).toBe(true);
  });
});

describe("isValidKeyPrefix — rejected shapes", () => {
  it.each([
    ["uppercase", "Auth_"],
    ["underscore", "auth_"],
    ["whitespace", "soma anthropic"],
    ["forward slash", "service/"],
    ["leading dot", ".soma"],
    ["leading hyphen", "-soma"],
    ["shell metachar $", "soma$"],
    ["shell metachar ;", "soma;"],
    ["65 characters", "x".repeat(65)],
    ["non-ASCII", "sömä"],
  ])("rejects %s", (_label, prefix) => {
    expect(isValidKeyPrefix(prefix)).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// assertValidKey / assertValidKeyPrefix — the loud half
// -----------------------------------------------------------------------------

describe("assertValidKey", () => {
  it("is a no-op for a conforming key", () => {
    expect(() => assertValidKey("auth-token", "write")).not.toThrow();
  });

  it("throws a typed error carrying the key, operation and kind", () => {
    let caught: unknown;
    try {
      assertValidKey("Auth_Token", "write");
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(InvalidCredentialKeyError);
    // Same taxonomy as the rest of the package, not a parallel one.
    expect(caught).toBeInstanceOf(VaultError);

    const err = caught as InvalidCredentialKeyError;
    expect(err.code).toBe("VAULT_INVALID_CREDENTIAL_KEY");
    expect(err.key).toBe("Auth_Token");
    expect(err.operation).toBe("write");
    expect(err.kind).toBe("key");
    expect(err.message).toContain("key grammar");
  });
});

describe("assertValidKeyPrefix", () => {
  it("is a no-op for a prefix ending on a separator", () => {
    expect(() => assertValidKeyPrefix("soma.anthropic.", "enumerate")).not.toThrow();
  });

  it("throws with kind 'prefix' so the message names the right thing", () => {
    let caught: unknown;
    try {
      assertValidKeyPrefix("Auth_", "enumerate");
    } catch (err) {
      caught = err;
    }

    const err = caught as InvalidCredentialKeyError;
    expect(err).toBeInstanceOf(InvalidCredentialKeyError);
    expect(err.kind).toBe("prefix");
    expect(err.operation).toBe("enumerate");
    expect(err.message).toContain("credential prefix");
  });
});
