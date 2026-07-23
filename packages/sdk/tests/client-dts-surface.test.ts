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

  // Issue #136 review finding 1: the list-only filters (`tagsMatch`,
  // `typeMetadata`) must NOT be structurally reachable from search() —
  // `SearchKnowledgeCrystalsParams` is a separate interface (it does not
  // extend the list params), so a search() caller cannot pass them and have
  // them silently dropped. This pins that separation in the PUBLISHED
  // declarations: if the two param types are ever merged/extended, this fails
  // loudly instead of the fields leaking into the search surface.
  //
  // #134 extended the list-only set with the ADR-040 incremental watermarks
  // (`createdAfter`/`updatedAfter`) and split the params into
  // `ListKnowledgeCrystalsFilters & (Offset|Keyset)PaginationParams` — so the
  // filter fields now live on the filters interface and the alias composes it.
  it("knowledge-crystal.d.ts declares the list-only filters on the list params only", () => {
    const dts = readDts(resolve(packageRoot, "dist/types/knowledge-crystal.d.ts"));

    // Slice a declaration body (from its name to the next `export` at column
    // 0). Property checks use declaration-shaped regexes (`name?:` at a line
    // start) so JSDoc prose mentions cannot false-match.
    const sliceDeclaration = (keyword: "interface" | "type", name: string): string => {
      const start = dts.indexOf(`export ${keyword} ${name}`);
      expect(start, `${name} missing from knowledge-crystal.d.ts`).toBeGreaterThanOrEqual(0);
      const rest = dts.slice(start + 1);
      const end = rest.search(/^export /m);
      return end === -1 ? rest : rest.slice(0, end);
    };

    const listFilters = sliceDeclaration("interface", "ListKnowledgeCrystalsFilters");
    expect(listFilters).toMatch(/^\s*tagsMatch\?\s*:/m);
    expect(listFilters).toMatch(/^\s*typeMetadata\?\s*:/m);
    expect(listFilters).toMatch(/^\s*createdAfter\?\s*:/m);
    expect(listFilters).toMatch(/^\s*updatedAfter\?\s*:/m);
    // Pagination is NOT part of the filters half — it is the union's job.
    expect(listFilters).not.toMatch(/^\s*offset\?\s*:/m);
    expect(listFilters).not.toMatch(/^\s*cursor\?\s*:/m);

    // The public alias still exists and composes filters with the mutually
    // exclusive pagination pair (a caller cannot pass both offset and cursor).
    const listParams = sliceDeclaration("type", "ListKnowledgeCrystalsParams");
    expect(listParams).toMatch(/ListKnowledgeCrystalsFilters/);
    expect(listParams).toMatch(/OffsetPaginationParams/);
    expect(listParams).toMatch(/KeysetPaginationParams/);

    // Each pagination mode declares the OTHER mode's field as `never`, which is
    // what makes the either/or a compile error rather than a runtime surprise.
    const offsetMode = sliceDeclaration("interface", "OffsetPaginationParams");
    expect(offsetMode).toMatch(/^\s*cursor\?\s*:\s*never;/m);
    const keysetMode = sliceDeclaration("interface", "KeysetPaginationParams");
    expect(keysetMode).toMatch(/^\s*offset\?\s*:\s*never;/m);

    const searchParams = sliceDeclaration("interface", "SearchKnowledgeCrystalsParams");
    // Search must not inherit or re-declare any list-only filter.
    expect(searchParams).not.toMatch(/extends/);
    expect(searchParams).not.toMatch(/^\s*tagsMatch\?\s*:/m);
    expect(searchParams).not.toMatch(/^\s*typeMetadata\?\s*:/m);
    expect(searchParams).not.toMatch(/^\s*createdAfter\?\s*:/m);
    expect(searchParams).not.toMatch(/^\s*updatedAfter\?\s*:/m);
    expect(searchParams).not.toMatch(/^\s*cursor\?\s*:/m);
  });

  // PR #146 R3 (api-contracts, HIGH): the pre-0.50.0 health shapes are
  // DEPRECATED, not removed — dropping a public type export is a breaking
  // change and the #145 changeset is a minor. Pin both the export (existing
  // importers keep compiling) and the @deprecated tag (the removal intent
  // survives to the next major) in the PUBLISHED declarations, so neither can
  // silently regress in either direction.
  it("keeps the deprecated pre-0.50.0 health shapes exported and tagged @deprecated", () => {
    const typesDts = readDts(resolve(packageRoot, "dist/types.d.ts"));
    const indexDts = readDts(indexDtsPath);
    for (const name of [
      "DependencyHealth",
      "CircuitBreakerStats",
      "RateLimiterStats",
    ]) {
      // Still re-exported from the package entry…
      expect(indexDts, `${name} missing from dist/index.d.ts`).toMatch(
        new RegExp(`\\b${name}\\b`),
      );
      // …still declared…
      const start = typesDts.indexOf(`export interface ${name}`);
      expect(start, `${name} missing from dist/types.d.ts`).toBeGreaterThanOrEqual(0);
      // …and the doc comment immediately preceding the declaration carries
      // the @deprecated tag.
      const docBlock = typesDts.slice(Math.max(0, start - 600), start);
      expect(docBlock, `${name} lacks an @deprecated tag`).toMatch(/@deprecated/);
    }
  });
});
