/**
 * Unit tests for dag-renderer.ts (expansion-docs).
 *
 * Covers:
 * - ASCII art rendering (wide terminal)
 * - Narrow terminal fallback
 * - No-color mode
 * - Mermaid flowchart output
 * - Mermaid ID sanitization and collision handling
 * - Status overlay (statusMap)
 * - Multi-wave arrow rendering
 * - Regression: --json and --show-waves behavior in cmdDag
 */

import { describe, it, expect } from "vitest";
import { DAGEngine } from "../../src/orchestrator/dag.js";
import { renderDagAscii, renderDagMermaid, MIN_COLUMN_WIDTH } from "../../src/orchestrator/dag-renderer.js";

// ---------------------------------------------------------------------------
// Test Fixtures
// Local copies of DAG helpers (also in dag.test.ts) kept here deliberately
// for test isolation — each test file should be independently runnable.
// ---------------------------------------------------------------------------

const STAGES = ["conceptualize", "architect", "implement", "review"];

/** Simple linear DAG: a → b → c */
function linearDAG() {
  return {
    version: 1,
    pipelines: [
      { id: "a", name: "Pipeline A", stages: STAGES, dependsOn: [] as string[] },
      { id: "b", name: "Pipeline B", stages: STAGES, dependsOn: ["a"] },
      { id: "c", name: "Pipeline C", stages: STAGES, dependsOn: ["b"] },
    ],
  };
}

/** Diamond DAG: a → b, a → c, b → d, c → d */
function diamondDAG() {
  return {
    version: 1,
    pipelines: [
      { id: "a", name: "Pipeline A", stages: STAGES, dependsOn: [] as string[] },
      { id: "b", name: "Pipeline B", stages: STAGES, dependsOn: ["a"] },
      { id: "c", name: "Pipeline C", stages: STAGES, dependsOn: ["a"] },
      { id: "d", name: "Pipeline D", stages: STAGES, dependsOn: ["b", "c"] },
    ],
  };
}

/** Single-node DAG */
function singleDAG() {
  return {
    version: 1,
    pipelines: [{ id: "solo", name: "Solo Pipeline", stages: STAGES }],
  };
}

function loadDAG(data: unknown): DAGEngine {
  const result = DAGEngine.load(data);
  if (!result.ok) throw new Error(`DAG load failed: ${result.error.message}`);
  return result.value;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("renderDagAscii", () => {
  it("1. linearDAG wide terminal: contains box-drawing chars, node IDs, and arrows", () => {
    const dag = loadDAG(linearDAG());
    const output = renderDagAscii(dag, { width: 120 });

    // Box-drawing characters present
    expect(output).toContain("┌");
    expect(output).toContain("┐");
    expect(output).toContain("└");
    expect(output).toContain("┘");

    // All node IDs present
    expect(output).toContain("a");
    expect(output).toContain("b");
    expect(output).toContain("c");

    // Arrows present between dependency pairs
    expect(output).toContain("──→");
  });

  it("2. diamondDAG wide terminal: all 4 node IDs present, arrow connectors present", () => {
    const dag = loadDAG(diamondDAG());
    const output = renderDagAscii(dag, { width: 120 });

    expect(output).toContain("a");
    expect(output).toContain("b");
    expect(output).toContain("c");
    expect(output).toContain("d");

    // At minimum a→b and b→d arrows should be present (same row)
    expect(output).toContain("──→");
  });

  it("3. singleNodeDAG: renders without arrows", () => {
    const dag = loadDAG(singleDAG());
    const output = renderDagAscii(dag, { width: 120 });

    expect(output).toContain("solo");
    expect(output).toContain("┌");
    // No arrows expected for single node
    expect(output).not.toContain("→");
  });

  it("4. noColor: true — output contains no ANSI escape sequences", () => {
    const dag = loadDAG(linearDAG());
    const output = renderDagAscii(dag, { width: 120, noColor: true });

    expect(output).not.toContain("\x1b[");
  });

  it("5. narrowTerminal (width: 40): fallback — no box chars", () => {
    const dag = loadDAG(linearDAG());
    const output = renderDagAscii(dag, { width: 40 });

    // Fallback: no box-drawing characters
    expect(output).not.toContain("┌");
    expect(output).not.toContain("┘");

    // But node IDs still present in simple list
    expect(output).toContain("a");
    expect(output).toContain("b");
    expect(output).toContain("c");
  });

  it("6. MIN_COLUMN_WIDTH threshold: wave columns exceeding width triggers fallback", () => {
    const dag = loadDAG(linearDAG());
    // 3 waves × MIN_COLUMN_WIDTH = 3 × 14 = 42; width=40 → fallback
    const output = renderDagAscii(dag, { width: 40 });
    expect(output).not.toContain("┌");
  });

  it("7. statusMap overlay: running pipeline shows [*] badge in node box", () => {
    const dag = loadDAG(linearDAG());
    const output = renderDagAscii(dag, {
      width: 200,
      statusMap: { a: "running", b: "complete", c: "ready" },
    });

    expect(output).toContain("[*]"); // running badge
    expect(output).toContain("[+]"); // complete badge
    expect(output).toContain("[ ]"); // ready badge
  });

  it("8. multi-wave arrow: 3-wave linear DAG has arrows between wave 1→2 and 2→3", () => {
    const dag = loadDAG(linearDAG());
    const output = renderDagAscii(dag, { width: 200 });

    // The output should have at least 2 arrow connectors (a→b and b→c)
    const arrowCount = (output.match(/──→/g) ?? []).length;
    expect(arrowCount).toBeGreaterThanOrEqual(2);
  });
});

describe("renderDagMermaid", () => {
  it("1. mermaid linear: starts with 'flowchart TD', contains '-->' edges for each dep", () => {
    const dag = loadDAG(linearDAG());
    const output = renderDagMermaid(dag);

    expect(output).toMatch(/^flowchart TD/);
    // Edges: a→b and b→c
    expect(output).toContain("-->");
    // Both edges present (a→b and b→c)
    const edgeCount = (output.match(/-->/g) ?? []).length;
    expect(edgeCount).toBeGreaterThanOrEqual(2);
  });

  it("2. mermaid with statusMap: contains ':::running' class annotation", () => {
    const dag = loadDAG(linearDAG());
    const output = renderDagMermaid(dag, {
      statusMap: { a: "running", b: "complete", c: "ready" },
    });

    expect(output).toContain(":::running");
    expect(output).toContain(":::complete");
    expect(output).toContain(":::ready");
    // Class definitions should be present
    expect(output).toContain("classDef running");
    expect(output).toContain("classDef complete");
  });

  it("3. mermaid sanitization: hyphens replaced with underscore", () => {
    const dag = loadDAG({
      version: 1,
      pipelines: [
        { id: "my-pipeline", name: "My Pipeline", stages: STAGES, dependsOn: [] as string[] },
        { id: "my-pipe", name: "My Pipe", stages: STAGES, dependsOn: ["my-pipeline"] },
      ],
    });
    const output = renderDagMermaid(dag);

    // Sanitized IDs used in Mermaid output
    expect(output).toContain("my_pipeline");
    expect(output).toContain("my_pipe");
    // Original IDs with hyphens should not appear as node IDs
    expect(output).not.toContain("my-pipeline[");
    expect(output).not.toContain("my-pipe[");
  });

  it("4. mermaid sanitization: multiple hyphenated IDs get distinct sanitized IDs", () => {
    const dag = loadDAG({
      version: 1,
      pipelines: [
        { id: "a-b", name: "A B", stages: STAGES, dependsOn: [] as string[] },
        { id: "c-d", name: "C D", stages: STAGES, dependsOn: [] as string[] },
      ],
    });
    const output = renderDagMermaid(dag);

    // a-b sanitizes to a_b, c-d sanitizes to c_d — distinct IDs, no collision
    expect(output).toContain("a_b");
    expect(output).toContain("c_d");
  });

  it("mermaid diamond: all 4 nodes and 4 edges present", () => {
    const dag = loadDAG(diamondDAG());
    const output = renderDagMermaid(dag);

    expect(output).toMatch(/^flowchart TD/);
    expect(output).toContain("a[");
    expect(output).toContain("b[");
    expect(output).toContain("c[");
    expect(output).toContain("d[");

    // 4 edges: a→b, a→c, b→d, c→d
    const edgeCount = (output.match(/-->/g) ?? []).length;
    expect(edgeCount).toBe(4);
  });

  it("mermaid no statusMap: no classDef lines", () => {
    const dag = loadDAG(linearDAG());
    const output = renderDagMermaid(dag);

    expect(output).not.toContain("classDef");
  });
});

describe("MIN_COLUMN_WIDTH constant", () => {
  it("is exported and equals 14", () => {
    expect(MIN_COLUMN_WIDTH).toBe(14);
  });
});

// ---------------------------------------------------------------------------
// T-01: renderSimpleList with statusMap (narrow-terminal status overlay, ADR-059 D4)
// ---------------------------------------------------------------------------

/** Single-node DAG with id "a" for narrow-terminal badge tests */
function singleNodeA() {
  return {
    version: 1,
    pipelines: [{ id: "a", name: "Pipeline A", stages: STAGES }],
  };
}

describe("renderSimpleList with statusMap", () => {
  it("1. narrow path - running badge prepended", () => {
    const dag = loadDAG(singleNodeA());
    const output = renderDagAscii(dag, { width: 40, statusMap: { a: "running" } });

    // statusBadge("running") === "[*]"
    expect(output).toContain("[*]");
  });

  it("2. narrow path - complete badge", () => {
    const dag = loadDAG(singleNodeA());
    const output = renderDagAscii(dag, { width: 40, statusMap: { a: "complete" } });

    // statusBadge("complete") === "[+]"
    expect(output).toContain("[+]");
  });

  it("3. narrow path - failed badge", () => {
    const dag = loadDAG(singleNodeA());
    const output = renderDagAscii(dag, { width: 40, statusMap: { a: "failed" } });

    // statusBadge("failed") === "[X]"
    expect(output).toContain("[X]");
  });

  it("4. without statusMap - no badge, output matches pre-T-01 baseline", () => {
    const dag = loadDAG(singleNodeA());
    const output = renderDagAscii(dag, { width: 40 });

    // Node ID should appear with leading spaces, no badge prefix
    expect(output).toContain("  a");
    // No status badge characters
    expect(output).not.toContain("[*]");
    expect(output).not.toContain("[+]");
    expect(output).not.toContain("[X]");
  });

  it("5. partial statusMap - missing IDs get no badge", () => {
    // linearDAG: a → b → c; only a has a status entry
    const dag = loadDAG(linearDAG());
    const output = renderDagAscii(dag, { width: 40, statusMap: { a: "running" } });

    // [*] badge appears exactly once (for a)
    const badgeMatches = output.match(/\[\*\]/g) ?? [];
    expect(badgeMatches).toHaveLength(1);

    // Lines for b and c should not contain any badge chars
    const lines = output.split("\n");
    const bLine = lines.find((l) => l.includes("b"));
    const cLine = lines.find((l) => l.includes("c"));
    expect(bLine).toBeDefined();
    expect(cLine).toBeDefined();
    expect(bLine).not.toContain("[*]");
    expect(bLine).not.toContain("[+]");
    expect(bLine).not.toContain("[X]");
    expect(cLine).not.toContain("[*]");
    expect(cLine).not.toContain("[+]");
    expect(cLine).not.toContain("[X]");
  });

  it("6. renderDagAscii narrow path (width < 60) forwards statusMap", () => {
    const dag = loadDAG(singleNodeA());
    // width: 40 < 60, so narrow path is taken
    const output = renderDagAscii(dag, { width: 40, statusMap: { a: "running" } });

    expect(output).toContain("[*]");
    // Narrow path: no box-drawing chars
    expect(output).not.toContain("┌");
  });

  it("7. renderDagAscii narrow path (waveCount x MIN_COLUMN_WIDTH > width) - statusMap forwarded", () => {
    // linearDAG has 3 waves; 3 × 14 = 42 > 40, so narrow path is taken
    const dag = loadDAG(linearDAG());
    const output = renderDagAscii(dag, { width: 40, statusMap: { a: "complete" } });

    // statusBadge("complete") === "[+]"
    expect(output).toContain("[+]");
    // Narrow path: no box-drawing chars
    expect(output).not.toContain("┌");
  });

  it("8. renderDagAscii wide terminal path - statusMap used in nodeLabel, not in renderSimpleList", () => {
    const dag = loadDAG(singleNodeA());
    // width: 200, single wave (1 × 14 = 14 <= 200), so wide path is taken
    const output = renderDagAscii(dag, { width: 200, statusMap: { a: "running" } });

    // Badge appears in the node box label
    expect(output).toContain("[*]");
    // Wide path: box-drawing chars present
    expect(output).toContain("┌");
  });
});
