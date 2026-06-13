/**
 * DAG Renderer (expansion-docs)
 *
 * Renders a DAGEngine as ASCII art (box-drawing characters) or Mermaid
 * flowchart syntax for terminal and external visualization.
 *
 * Pure rendering functions -- no I/O, no process access.
 *
 * @module orchestrator/dag-renderer
 */

import type { DAGEngine } from "./dag.js";
import type { PipelineStatus } from "./types.js";
import { statusBadge, truncate } from "./formatters.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum column width for a node box (inner content + 2 border chars). */
export const MIN_COLUMN_WIDTH = 14;

/** Maximum pipeline ID display length before truncation. */
const MAX_ID_DISPLAY_LENGTH = 30;

/** Width of the arrow connector section between wave columns. */
const ARROW_WIDTH = 5; // " ──→ "

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DagRenderOpts {
  /** Terminal width for layout. Default: 80. */
  width?: number;
  /** Disable ANSI color output. */
  noColor?: boolean;
  /**
   * Pipeline status map for status overlay.
   * Keyed by pipeline ID → PipelineStatus.
   */
  statusMap?: Record<string, PipelineStatus>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render the DAG as ASCII art (box-drawing characters).
 * Returns a multi-line string — caller writes to stdout.
 *
 * Layout: wave columns left-to-right. Each wave is a vertical
 * stack of node boxes. Arrows connect dependency → dependent nodes.
 *
 * Falls back to simple list format when width < 60 OR
 * waveCount × MIN_COLUMN_WIDTH > width.
 */
export function renderDagAscii(dag: DAGEngine, opts?: DagRenderOpts): string {
  const width = opts?.width ?? 80;
  const statusMap = opts?.statusMap;

  const waves = dag.getAllWaves();
  const waveCount = waves.length;

  if (waveCount === 0) {
    return "  (empty DAG)\n";
  }

  // Narrow-terminal fallback: width < 60 OR wave columns exceed available width
  if (width < 60 || waveCount * MIN_COLUMN_WIDTH > width) {
    return renderSimpleList(dag, statusMap);
  }

  // Build node label (with optional status badge)
  function nodeLabel(id: string): string {
    const displayId = truncate(id, MAX_ID_DISPLAY_LENGTH);
    if (statusMap && statusMap[id] !== undefined) {
      return statusBadge(statusMap[id]!) + " " + displayId;
    }
    return displayId;
  }

  // Compute inner width for each wave column
  // inner = max label length in wave; box width = inner + 2 (for │...│)
  const innerWidths = waves.map((wave) => {
    const maxLabel = Math.max(
      MIN_COLUMN_WIDTH - 2, // subtract 2 for border chars
      ...wave.map((id) => nodeLabel(id).length),
    );
    return maxLabel;
  });

  const maxRows = Math.max(...waves.map((w) => w.length));
  const lines: string[] = [];

  for (let row = 0; row < maxRows; row++) {
    let topLine = "";
    let midLine = "";
    let botLine = "";

    for (let waveIdx = 0; waveIdx < waveCount; waveIdx++) {
      const innerW = innerWidths[waveIdx]!;
      const nodeId = waves[waveIdx]![row];

      if (nodeId !== undefined) {
        const label = nodeLabel(nodeId);
        // Pad label to exactly innerW characters
        const paddedLabel =
          label.length >= innerW
            ? label.slice(0, innerW)
            : label + " ".repeat(innerW - label.length);

        topLine += "┌" + "─".repeat(innerW) + "┐";
        midLine += "│" + paddedLabel + "│";
        botLine += "└" + "─".repeat(innerW) + "┘";
      } else {
        const fullW = innerW + 2; // +2 for border chars
        topLine += " ".repeat(fullW);
        midLine += " ".repeat(fullW);
        botLine += " ".repeat(fullW);
      }

      // Arrow connector between wave columns
      if (waveIdx < waveCount - 1) {
        const currNodeId = waves[waveIdx]![row];
        const nextNodeId = waves[waveIdx + 1]![row];

        // Show arrow if both nodes exist and next depends on current
        const hasArrow =
          currNodeId !== undefined &&
          nextNodeId !== undefined &&
          (dag.getDependencies(nextNodeId) as readonly string[]).includes(currNodeId);

        const connector = hasArrow ? " ──→ " : " ".repeat(ARROW_WIDTH);
        topLine += " ".repeat(ARROW_WIDTH);
        midLine += connector;
        botLine += " ".repeat(ARROW_WIDTH);
      }
    }

    lines.push(topLine, midLine, botLine);
    if (row < maxRows - 1) {
      lines.push(""); // blank gap between node rows
    }
  }

  return lines.join("\n") + "\n";
}

/**
 * Render the DAG as Mermaid flowchart syntax (flowchart TD).
 * Returns Mermaid source — caller wraps in code block if needed.
 *
 * Status annotations: when statusMap is present, each node gets a CSS
 * class based on its status for styling in rendered output.
 */
export function renderDagMermaid(dag: DAGEngine, opts?: DagRenderOpts): string {
  const statusMap = opts?.statusMap;
  const pipelines = dag.getPipelines();

  // Build sanitized ID map with collision detection
  const sanitizedIds = buildSanitizedIdMap(pipelines.map((p) => p.id));

  const lines: string[] = ["flowchart TD"];

  // Node declarations
  for (const p of pipelines) {
    const safeId = sanitizedIds.get(p.id)!;
    const rawLabel = p.name ?? p.id;
    // Escape characters that would break Mermaid ["label"] syntax
    const label = rawLabel.replace(/"/g, "#quot;").replace(/\[/g, "#91;").replace(/]/g, "#93;");
    const statusClass =
      statusMap && statusMap[p.id] !== undefined
        ? `:::${statusMap[p.id]}`
        : "";
    lines.push(`    ${safeId}["${label}"]${statusClass}`);
  }

  // Edges
  for (const p of pipelines) {
    const deps = p.dependsOn ?? [];
    for (const dep of deps) {
      const fromId = sanitizedIds.get(dep);
      const toId = sanitizedIds.get(p.id);
      if (fromId && toId) {
        lines.push(`    ${fromId} --> ${toId}`);
      }
    }
  }

  // Class definitions (always include when statusMap provided)
  if (statusMap) {
    lines.push(`    classDef running fill:#ffd700`);
    lines.push(`    classDef complete fill:#90ee90`);
    lines.push(`    classDef failed fill:#ff6b6b`);
    lines.push(`    classDef ready fill:#e0e0e0`);
    lines.push(`    classDef blocked fill:#ff9966`);
    lines.push(`    classDef skipped fill:#cccccc`);
    lines.push(`    classDef awaiting_merge fill:#99ccff`);
  }

  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Render the DAG as a simple text list (narrow-terminal fallback).
 * Returns content only — no header/footer.
 *
 * Accepts an optional statusMap to prepend status badges to each pipeline line,
 * matching the overlay behavior of the wide-terminal ASCII art mode (ADR-059 D4).
 *
 * @param dag - The DAG engine instance containing pipeline definitions.
 * @param statusMap - Optional map of pipeline ID to status for badge rendering.
 */
function renderSimpleList(
  dag: DAGEngine,
  statusMap?: Record<string, PipelineStatus>,
): string {
  const pipelines = dag.getPipelines();
  const lines: string[] = [];

  for (const p of pipelines) {
    const badge =
      statusMap?.[p.id] !== undefined ? statusBadge(statusMap[p.id]!) + " " : "";
    const deps = p.dependsOn ?? [];
    if (deps.length === 0) {
      lines.push(`  ${badge}${p.id}`);
    } else {
      lines.push(`  ${badge}${deps.join(", ")} \u2500\u2500 ${p.id}`);
    }
  }

  return lines.join("\n") + "\n";
}

/**
 * Sanitize pipeline IDs for Mermaid node identifiers.
 * Replaces non-alphanumeric/underscore characters with `_`.
 * Appends `_N` suffix on collision (e.g., `a-b` and `a_b` → `a_b` and `a_b_0`).
 */
function buildSanitizedIdMap(ids: string[]): Map<string, string> {
  const result = new Map<string, string>();
  const usedIds = new Set<string>();

  for (const id of ids) {
    let safeId = id.replace(/[^a-zA-Z0-9_]/g, "_");

    if (usedIds.has(safeId)) {
      // Find a unique suffix
      let suffix = 0;
      while (usedIds.has(`${safeId}_${suffix}`)) {
        suffix++;
      }
      safeId = `${safeId}_${suffix}`;
    }

    usedIds.add(safeId);
    result.set(id, safeId);
  }

  return result;
}
