/**
 * Notes Dedup Resource Tests
 *
 * Tests for NotesResource.dedup() (issue #81): the explicit dedup-check
 * trigger at POST /v1/notes/:id/dedup. The 200 response is a BARE object
 * (NOT the standard `{ data }` envelope) with snake_case wire fields that the
 * SDK normalizes to camelCase.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EngramClient } from "../../src/client.js";
import { EngramError } from "../../src/errors.js";

function mockFetchResponse(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data) ?? ""),
  });
}

const NOTE_ID = "33333333-3333-4333-8333-333333333333";

describe("NotesResource.dedup", () => {
  let client: EngramClient;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = new EngramClient({
      baseUrl: "http://localhost:3100",
      timeout: 5000,
      retries: 1,
    });
    mockFetch = mockFetchResponse({});
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("POSTs to /v1/notes/:id/dedup with an empty body by default", async () => {
    mockFetch = mockFetchResponse({
      action: "no_match",
      merge_id: null,
      confidence: null,
      canonical_id: null,
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await client.notes.dedup(NOTE_ID);

    expect(mockFetch).toHaveBeenCalledWith(
      `http://localhost:3100/v1/notes/${NOTE_ID}/dedup`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({}),
      })
    );
    expect(result.action).toBe("no_match");
    expect(result.mergeId).toBeNull();
  });

  it("normalizes snake_case wire fields to camelCase on a merged result", async () => {
    mockFetch = mockFetchResponse({
      action: "merged",
      merge_id: "merge-1",
      confidence: 0.97,
      canonical_id: "canon-1",
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await client.notes.dedup(NOTE_ID);

    expect(result).toEqual({
      action: "merged",
      mergeId: "merge-1",
      confidence: 0.97,
      canonicalId: "canon-1",
    });
  });

  it("maps mergeMethod/threshold to strict snake_case body keys", async () => {
    mockFetch = mockFetchResponse({
      action: "deferred",
      merge_id: "merge-2",
      confidence: 0.81,
      canonical_id: null,
    });
    vi.stubGlobal("fetch", mockFetch);

    await client.notes.dedup(NOTE_ID, { mergeMethod: "exact", threshold: 0.8 });

    expect(mockFetch).toHaveBeenCalledWith(
      `http://localhost:3100/v1/notes/${NOTE_ID}/dedup`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ merge_method: "exact", threshold: 0.8 }),
      })
    );
  });

  it("passes through non-null fields even when action is no_match", async () => {
    // The SDK does not enforce cross-field invariants (e.g. "no_match implies
    // all-null") — that is the server's contract. It DOES validate each field's
    // type and surface whatever the server sent, so an unexpected non-null on a
    // no_match is passed through verbatim rather than being silently dropped.
    mockFetch = mockFetchResponse({
      action: "no_match",
      merge_id: "unexpected-merge",
      confidence: 0.5,
      canonical_id: "unexpected-canon",
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await client.notes.dedup(NOTE_ID);

    expect(result).toEqual({
      action: "no_match",
      mergeId: "unexpected-merge",
      confidence: 0.5,
      canonicalId: "unexpected-canon",
    });
  });

  it("throws when the action discriminant is missing (contract drift)", async () => {
    mockFetch = mockFetchResponse({ merge_id: null });
    vi.stubGlobal("fetch", mockFetch);

    await expect(client.notes.dedup(NOTE_ID)).rejects.toBeInstanceOf(
      EngramError
    );
  });

  it("throws when merge_id is a non-string (contract drift)", async () => {
    mockFetch = mockFetchResponse({
      action: "merged",
      merge_id: 12345,
      confidence: 0.9,
      canonical_id: "canon-1",
    });
    vi.stubGlobal("fetch", mockFetch);

    await expect(client.notes.dedup(NOTE_ID)).rejects.toBeInstanceOf(
      EngramError
    );
  });

  it("throws when confidence is a non-number (contract drift)", async () => {
    mockFetch = mockFetchResponse({
      action: "merged",
      merge_id: "merge-1",
      confidence: "0.9",
      canonical_id: "canon-1",
    });
    vi.stubGlobal("fetch", mockFetch);

    await expect(client.notes.dedup(NOTE_ID)).rejects.toBeInstanceOf(
      EngramError
    );
  });

  it("throws EngramError carrying the server code on 404", async () => {
    mockFetch = mockFetchResponse(
      { error: { code: "RES_NOT_FOUND", message: "Note not found" } },
      404
    );
    vi.stubGlobal("fetch", mockFetch);

    await expect(client.notes.dedup(NOTE_ID)).rejects.toMatchObject({
      code: "RES_NOT_FOUND",
    });
    await expect(client.notes.dedup(NOTE_ID)).rejects.toBeInstanceOf(
      EngramError
    );
  });
});
