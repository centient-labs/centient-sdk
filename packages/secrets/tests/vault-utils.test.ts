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
import { isValidKey } from "../src/vault/vault-utils.js";

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
