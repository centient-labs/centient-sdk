/**
 * Declaration-surface smoke test.
 *
 * Guards the `stripInternal` contract: the `@internal` request helpers AND the
 * `@internal` `apiKey` secret must NOT appear in the emitted public
 * declarations, while the public `baseUrl` property must remain. If an
 * `@internal` tag is dropped (or `stripInternal` is disabled), internal
 * plumbing or the credential silently re-enters the published type surface —
 * this test fails loudly instead.
 *
 * Reads the built `dist/*.d.ts`. CI runs `build` before `test` (turbo: test
 * dependsOn build), so the declarations are present; a bare local `vitest run`
 * without a prior build fails with an actionable message rather than shelling
 * out to a build (which would couple this test to a package manager).
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const clientDtsPath = resolve(packageRoot, "dist/client.d.ts");
const indexDtsPath = resolve(packageRoot, "dist/index.d.ts");

function readDts(path: string): string {
  if (!existsSync(path)) {
    throw new Error(
      `${path} not found — build the package before running this test ` +
        `(CI runs build before test; locally run \`pnpm build\` in packages/sdk first).`,
    );
  }
  return readFileSync(path, "utf-8");
}

// The internal request helpers, matched by NAME on a word boundary. Word
// boundaries (not a trailing "(") because most of these are generic and emit as
// `_request<T>(...)` in the .d.ts — a "name(" substring would miss the generic
// form (false negative). `\b_request\b` does not match `_requestRaw` (no
// boundary before "Raw"), so the entries stay independent.
const INTERNAL_METHOD_PATTERNS = [
  /\b_request\b/,
  /\b_requestRaw\b/,
  /\b_requestRawBody\b/,
  /\b_requestFormData\b/,
];

describe("published declaration surface", () => {
  it("client.d.ts omits the @internal request helpers", () => {
    const dts = readDts(clientDtsPath);
    for (const pattern of INTERNAL_METHOD_PATTERNS) {
      expect(dts, `${pattern} leaked into dist/client.d.ts`).not.toMatch(pattern);
    }
  });

  it("client.d.ts keeps baseUrl public but strips the apiKey secret", () => {
    const dts = readDts(clientDtsPath);
    // baseUrl stays as a public property declaration (not a comment mention).
    expect(dts).toMatch(/readonly baseUrl\s*:/);
    // apiKey is @internal → must NOT appear as a declared property.
    expect(dts).not.toMatch(/readonly apiKey\s*\??\s*:/);
  });

  it("index.d.ts (the package 'types' entry) re-exports EngramClient and exposes neither the helpers nor apiKey", () => {
    // index.d.ts is a re-export barrel today (does NOT inline members), so the
    // absence checks are belt-and-suspenders against a future bundled-dts setup
    // (API Extractor / rollup-plugin-dts) that would inline the class shape.
    const dts = readDts(indexDtsPath);
    expect(dts).toMatch(/EngramClient/);
    for (const pattern of INTERNAL_METHOD_PATTERNS) {
      expect(dts, `${pattern} leaked into dist/index.d.ts`).not.toMatch(pattern);
    }
    expect(dts).not.toMatch(/readonly apiKey\s*\??\s*:/);
  });
});
