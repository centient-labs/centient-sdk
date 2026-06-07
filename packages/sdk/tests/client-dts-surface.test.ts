/**
 * Declaration-surface smoke test.
 *
 * Guards the `stripInternal` contract: the `@internal` request helpers must NOT
 * appear in the emitted public `dist/client.d.ts`, while the documented public
 * `baseUrl` / `apiKey` properties must remain. If an `@internal` tag is dropped
 * (or `stripInternal` is disabled), internal plumbing silently re-enters the
 * published type surface — this test fails loudly instead.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dtsPath = resolve(packageRoot, "dist/client.d.ts");

describe("published client.d.ts surface", () => {
  beforeAll(() => {
    // CI runs `build` before `test` (turbo test dependsOn build), so dist
    // normally exists. Build on demand for a bare local `vitest run`.
    if (!existsSync(dtsPath)) {
      execSync("npm run build", { cwd: packageRoot, stdio: "ignore" });
    }
  });

  it("omits the @internal request helpers", () => {
    const dts = readFileSync(dtsPath, "utf-8");
    for (const internal of [
      "_request",
      "_requestRaw",
      "_requestRawBody",
      "_requestFormData",
    ]) {
      expect(dts, `${internal} leaked into the public .d.ts`).not.toContain(internal);
    }
  });

  it("keeps baseUrl and apiKey as public properties", () => {
    const dts = readFileSync(dtsPath, "utf-8");
    expect(dts).toContain("baseUrl");
    expect(dts).toContain("apiKey");
  });
});
