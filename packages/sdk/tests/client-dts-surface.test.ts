/**
 * Declaration-surface smoke test.
 *
 * Guards the `stripInternal` contract: the `@internal` request helpers must NOT
 * appear in the emitted public declarations, while the documented public
 * `baseUrl` / `apiKey` properties must remain as property declarations. If an
 * `@internal` tag is dropped (or `stripInternal` is disabled), internal
 * plumbing silently re-enters the published type surface — this test fails
 * loudly instead.
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
        `(CI runs build before test; locally run \`npm run build\` in packages/sdk first).`,
    );
  }
  return readFileSync(path, "utf-8");
}

// The internal request helpers, matched as method declarations (name + "(") so
// each entry is an independent guard rather than a substring of its siblings.
const INTERNAL_METHODS = [
  "_request(",
  "_requestRaw(",
  "_requestRawBody(",
  "_requestFormData(",
];

describe("published declaration surface", () => {
  it("client.d.ts omits the @internal request helpers", () => {
    const dts = readDts(clientDtsPath);
    for (const method of INTERNAL_METHODS) {
      expect(dts, `${method} leaked into dist/client.d.ts`).not.toContain(method);
    }
  });

  it("client.d.ts keeps baseUrl and apiKey as public property declarations", () => {
    const dts = readDts(clientDtsPath);
    // Match the property declaration, not a mere mention in a comment/string.
    expect(dts).toMatch(/readonly baseUrl\s*:/);
    expect(dts).toMatch(/readonly apiKey\s*\??\s*:/);
  });

  it("index.d.ts (the package 'types' entry) does not re-expose the helpers", () => {
    const dts = readDts(indexDtsPath);
    for (const method of INTERNAL_METHODS) {
      expect(dts, `${method} leaked into dist/index.d.ts`).not.toContain(method);
    }
  });
});
