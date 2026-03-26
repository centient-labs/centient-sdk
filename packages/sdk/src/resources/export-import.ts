/**
 * Export/Import Resource
 *
 * SDK interface for backup, restore, and migration of knowledge graph data
 * (ADR-042 Crystal Export/Import Fidelity).
 *
 * Endpoints:
 *   POST /v1/export/estimate  — estimate export size (JSON in, JSON out)
 *   POST /v1/export           — stream binary export (JSON in, binary stream out)
 *   POST /v1/import           — import archive (FormData in, JSON out)
 *   POST /v1/import/preview   — preview import without changes (FormData in, JSON out)
 */

import type { EngramClient } from "../client.js";
import { BaseResource } from "./base.js";
import type {
  ExportEstimate,
  ExportParams,
  ImportOptions,
  ImportPreview,
  ImportResult,
} from "../types/export-import.js";

// Backend wraps all JSON responses in { data: T, meta?: { timing?: ... } }
interface ApiSuccessResponse<T> {
  data: T;
  meta?: {
    timing?: { durationMs: number };
  };
}

// Re-export types for convenience
export type {
  ExportScope,
  ExportEntityType,
  ExportFilter,
  ExportParams,
  ExportEstimate,
  ConflictResolution,
  ImportOptions,
  ImportConflict,
  ImportPreview,
  ImportResult,
} from "../types/export-import.js";

/**
 * Export/Import Resource — backup, restore, and migration of Engram data.
 *
 * Accessed via `client.exportImport`.
 */
export class ExportImportResource extends BaseResource {
  constructor(client: EngramClient) {
    super(client);
  }

  /**
   * Estimate the size and entity counts for a prospective export.
   *
   * POST /v1/export/estimate
   *
   * @param params - Export scope, filters, format, and compression settings.
   * @returns Estimated entity counts and byte size.
   */
  async estimateExport(params: ExportParams): Promise<ExportEstimate> {
    const response = await this.request<ApiSuccessResponse<ExportEstimate>>(
      "POST",
      "/v1/export/estimate",
      params,
    );
    return response.data;
  }

  /**
   * Stream a binary export archive.
   *
   * POST /v1/export
   *
   * Returns the raw `Response` object so callers can stream the body directly,
   * pipe it to a file, or pass it to `exportStream()` for chunk iteration.
   *
   * @param params - Export scope, filters, format, and compression settings.
   * @returns Raw fetch `Response` with streaming body.
   */
  async export(params: ExportParams): Promise<Response> {
    return this.client._requestRaw("POST", "/v1/export", params);
  }

  /**
   * Stream a binary export as an async iterable of `Uint8Array` chunks.
   *
   * Convenience wrapper around `export()` — suitable for piping to disk
   * or processing incrementally without buffering the full archive.
   *
   * @param params - Export scope, filters, format, and compression settings.
   * @yields Binary chunks from the export body.
   */
  async *exportStream(params: ExportParams): AsyncIterable<Uint8Array> {
    const response = await this.export(params);

    if (!response.body) {
      return;
    }

    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Import an archive file into Engram.
   *
   * POST /v1/import
   *
   * @param file - The archive file to import (`Blob` or `File`).
   * @param options - Conflict resolution strategy and import flags.
   * @returns Import result with counts and any errors.
   */
  async importData(file: Blob | File, options: ImportOptions): Promise<ImportResult> {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("options", JSON.stringify(options));
    const response = await this.client._requestFormData<ApiSuccessResponse<ImportResult>>(
      "POST",
      "/v1/import",
      formData,
    );
    return response.data;
  }

  /**
   * Preview an import without making any changes.
   *
   * POST /v1/import/preview
   *
   * Returns a preview of what would be imported, including conflict counts
   * and schema version compatibility, without modifying any data.
   *
   * @param file - The archive file to preview (`Blob` or `File`).
   * @returns Import preview with counts, conflicts, and schema info.
   */
  async previewImport(file: Blob | File): Promise<ImportPreview> {
    const formData = new FormData();
    formData.append("file", file);
    const response = await this.client._requestFormData<ApiSuccessResponse<ImportPreview>>(
      "POST",
      "/v1/import/preview",
      formData,
    );
    return response.data;
  }
}
