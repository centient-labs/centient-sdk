/**
 * Invitations Resource Tests (ADR-044 — engram-server 0.50.0).
 *
 * Covers all 10 methods: the 7 authenticated inviter/invitee-side calls
 * (list, create, get, revoke, resend, retryBindings, listReceived) and the 3
 * public token-addressed redeem calls (redeemPreview, accept, decline).
 *
 * Contract focus:
 *  - strict paginated `{ success, data: [], meta.pagination }` envelope
 *    assertions on `list` / `listReceived` (no silent `data.length` fallback);
 *  - nested-object shape guards (bindings[], reveal, user, key, inviter,
 *    groups) — a reshaped nested object throws ResponseShapeError, never a
 *    downstream TypeError, and the one-time secrets (reveal.token, key.value)
 *    can never surface as undefined;
 *  - PRESENCE guards: every wire field is required (nullables arrive as
 *    explicit `null`), so an ABSENT nullable field is contract drift too;
 *  - the redeem error ladder: 404 unknown token → NotFoundError, 410
 *    expired/consumed → GoneError (typed, code preserved), 409 state conflict
 *    → EngramError with the INVITE_* code, 400 invalid accept body → typed 400;
 *  - the redeem routes are callable from a CREDENTIAL-LESS client (no
 *    apiKey/userId configured → no X-API-Key / X-User-ID headers sent — the
 *    token is the credential).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EngramClient } from "../../src/client.js";
import {
  EngramError,
  GoneError,
  NotFoundError,
  ResponseShapeError,
} from "../../src/errors.js";
import type {
  AcceptInvitationResponse,
  InvitationBinding,
  InvitationCreateResponse,
  InvitationSummary,
  ReceivedInvitation,
  RedeemPreview,
} from "../../src/types/invitations.js";

// ============================================================================
// Helpers
// ============================================================================

function mockFetchResponse(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

/** The nested `{ error: { code, message, details? } }` envelope engram emits. */
function errorBody(code: string, message: string, details?: unknown) {
  return { error: { code, message, ...(details ? { details } : {}) } };
}

/** The standard `{ success, data }` envelope. */
function enveloped(data: unknown) {
  return { success: true, data };
}

/** The strict paginated envelope the two list routes emit. */
function paginated(items: unknown[], overrides?: Record<string, unknown>) {
  return {
    success: true,
    data: items,
    meta: {
      pagination: {
        total: items.length,
        limit: 50,
        hasMore: false,
        ...overrides,
      },
    },
  };
}

// ============================================================================
// Fixtures (field-for-field against the 0.50.0 OpenAPI schemas)
// ============================================================================

const INVITATION_ID = "11111111-1111-4111-8111-111111111111";
const GROUP_ID = "22222222-2222-4222-8222-222222222222";
const INVITER_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "44444444-4444-4444-8444-444444444444";
const TOKEN = "inv_c0ffee.raw-token-value";

const appliedBinding: InvitationBinding = {
  groupId: GROUP_ID,
  groupName: "platform-team",
  role: "member",
  status: "applied",
  resolutionReason: null,
  resolvedAt: "2026-07-01T00:00:10.000Z",
};

const refusedBinding: InvitationBinding = {
  groupId: "55555555-5555-4555-8555-555555555555",
  groupName: null,
  role: "admin",
  status: "refused",
  resolutionReason: "inviter_no_longer_admin",
  resolvedAt: "2026-07-01T00:00:10.000Z",
};

const pendingInvitation: InvitationSummary = {
  id: INVITATION_ID,
  kind: "local",
  email: "new.teammate@example.com",
  displayNameHint: "Casey",
  message: "Join us!",
  tokenPrefix: "inv_c0ff",
  state: "pending",
  status: "pending",
  inviterUserId: INVITER_ID,
  createdUserId: null,
  expiresAt: "2026-07-14T00:00:00.000Z",
  createdAt: "2026-07-01T00:00:00.000Z",
  acceptedAt: null,
  revokedAt: null,
  declinedAt: null,
  resendCount: 0,
  bindings: [{ ...appliedBinding, status: "pending", resolvedAt: null }],
};

const expiredInvitation: InvitationSummary = {
  ...pendingInvitation,
  id: "66666666-6666-4666-8666-666666666666",
  // Derived state: stored status stays `pending`, computed state is `expired`.
  state: "expired",
  status: "pending",
};

const createResponse: InvitationCreateResponse = {
  invitation: pendingInvitation,
  reveal: {
    token: TOKEN,
    acceptUrl: `https://engram.example.com/invite/${TOKEN}`,
  },
};

const redeemPreview: RedeemPreview = {
  state: "pending",
  inviterDisplayName: "Owen",
  instanceName: "centient-hq",
  message: "Join us!",
  displayNameHint: "Casey",
  email: "new.teammate@example.com",
  groups: [{ groupId: GROUP_ID, name: "platform-team" }],
};

const acceptResponse: AcceptInvitationResponse = {
  user: {
    id: USER_ID,
    name: "casey",
    displayName: "Casey",
    createdAt: "2026-07-02T00:00:00.000Z",
  },
  key: {
    id: "key-1",
    name: "casey-default",
    prefix: "egk_ab12",
    value: "egk_ab12.one-time-secret",
  },
  bindings: [appliedBinding, refusedBinding],
};

const receivedInvitation: ReceivedInvitation = {
  id: INVITATION_ID,
  inviter: { id: INVITER_ID, name: "owen", displayName: "Owen" },
  message: "Join us!",
  acceptedAt: "2026-07-02T00:00:00.000Z",
  bindings: [appliedBinding],
};

// ============================================================================
// Test Setup
// ============================================================================

describe("InvitationsResource", () => {
  let client: EngramClient;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = new EngramClient({
      baseUrl: "http://localhost:3100",
      apiKey: "test-api-key",
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

  // ==========================================================================
  // list()
  // ==========================================================================

  describe("invitations.list", () => {
    it("GETs /v1/invitations and returns invitations with pagination", async () => {
      mockFetch = mockFetchResponse(paginated([pendingInvitation, expiredInvitation]));
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.invitations.list();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/invitations",
        expect.objectContaining({ method: "GET" }),
      );
      expect(result.invitations).toHaveLength(2);
      expect(result.invitations[0].id).toBe(INVITATION_ID);
      expect(result.total).toBe(2);
      expect(result.hasMore).toBe(false);
    });

    it("keeps status (stored, 4 values) and state (computed, 5 values) distinct", async () => {
      mockFetch = mockFetchResponse(paginated([expiredInvitation]));
      vi.stubGlobal("fetch", mockFetch);

      const { invitations } = await client.invitations.list({ status: "expired" });

      // A derived-expired row: stored status is still `pending`, computed
      // state is `expired` — the SDK passes both through untouched.
      expect(invitations[0].status).toBe("pending");
      expect(invitations[0].state).toBe("expired");
    });

    it("serializes status/all/limit/offset query params", async () => {
      mockFetch = mockFetchResponse(paginated([]));
      vi.stubGlobal("fetch", mockFetch);

      await client.invitations.list({
        status: "pending",
        all: true,
        limit: 10,
        offset: 20,
      });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toBe(
        "http://localhost:3100/v1/invitations?status=pending&all=true&limit=10&offset=20",
      );
    });

    it("surfaces hasMore:true unchanged from meta.pagination", async () => {
      mockFetch = mockFetchResponse(paginated([pendingInvitation], { total: 51, hasMore: true }));
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.invitations.list({ limit: 1 });
      expect(result.hasMore).toBe(true);
      expect(result.total).toBe(51);
    });

    it("throws ResponseShapeError when meta.pagination is absent (no silent data.length fallback)", async () => {
      const bad = mockFetchResponse({ success: true, data: [pendingInvitation] });
      vi.stubGlobal("fetch", bad);

      await expect(client.invitations.list()).rejects.toBeInstanceOf(ResponseShapeError);
      expect(bad).toHaveBeenCalledTimes(1);
    });

    it("throws ResponseShapeError when meta.pagination.total is missing", async () => {
      const bad = mockFetchResponse({
        success: true,
        data: [pendingInvitation],
        meta: { pagination: { limit: 50, hasMore: false } },
      });
      vi.stubGlobal("fetch", bad);

      await expect(client.invitations.list()).rejects.toBeInstanceOf(ResponseShapeError);
    });

    it("throws ResponseShapeError when data is not an array", async () => {
      const bad = mockFetchResponse(enveloped({ not: "an array" }));
      vi.stubGlobal("fetch", bad);

      await expect(client.invitations.list()).rejects.toBeInstanceOf(ResponseShapeError);
    });

    it("throws ResponseShapeError when a summary drops a required field (tokenPrefix)", async () => {
      const { tokenPrefix, ...withoutPrefix } = pendingInvitation;
      void tokenPrefix;
      const bad = mockFetchResponse(paginated([withoutPrefix]));
      vi.stubGlobal("fetch", bad);

      await expect(client.invitations.list()).rejects.toBeInstanceOf(ResponseShapeError);
    });

    it("throws ResponseShapeError when a NULLABLE required field is ABSENT (presence, not just type)", async () => {
      // `acceptedAt` is nullable but REQUIRED on the wire — the server always
      // emits it (as null). Its absence is contract drift, not a legal null.
      const { acceptedAt, ...withoutAcceptedAt } = pendingInvitation;
      void acceptedAt;
      const bad = mockFetchResponse(paginated([withoutAcceptedAt]));
      vi.stubGlobal("fetch", bad);

      await expect(client.invitations.list()).rejects.toBeInstanceOf(ResponseShapeError);
    });

    it("throws ResponseShapeError when a nested binding is reshaped", async () => {
      const bad = mockFetchResponse(
        paginated([
          {
            ...pendingInvitation,
            bindings: [{ groupId: GROUP_ID }], // missing role/status/…
          },
        ]),
      );
      vi.stubGlobal("fetch", bad);

      await expect(client.invitations.list()).rejects.toBeInstanceOf(ResponseShapeError);
    });
  });

  // ==========================================================================
  // create()
  // ==========================================================================

  describe("invitations.create", () => {
    it("POSTs the create body and returns invitation + one-time reveal", async () => {
      mockFetch = mockFetchResponse(enveloped(createResponse), 201);
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.invitations.create({
        email: "new.teammate@example.com",
        displayNameHint: "Casey",
        message: "Join us!",
        expiresInDays: 14,
        groups: [{ groupId: GROUP_ID, role: "member" }],
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/invitations",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            email: "new.teammate@example.com",
            displayNameHint: "Casey",
            message: "Join us!",
            expiresInDays: 14,
            groups: [{ groupId: GROUP_ID, role: "member" }],
          }),
        }),
      );
      expect(result.invitation.id).toBe(INVITATION_ID);
      expect(result.reveal.token).toBe(TOKEN);
      expect(result.reveal.acceptUrl).toContain(TOKEN);
    });

    it("throws a 403 EngramError (RES_FORBIDDEN) when the inviter lacks group-admin rights", async () => {
      mockFetch = mockFetchResponse(
        errorBody("RES_FORBIDDEN", "Inviter lacks group-admin rights"),
        403,
      );
      vi.stubGlobal("fetch", mockFetch);

      const err = await client.invitations
        .create({ email: "x@example.com", groups: [{ groupId: GROUP_ID }] })
        .catch((e) => e);
      expect(err).toBeInstanceOf(EngramError);
      expect((err as EngramError).code).toBe("RES_FORBIDDEN");
      expect((err as EngramError).statusCode).toBe(403);
    });

    it("throws a 400 EngramError when kind:'federated' is rejected", async () => {
      mockFetch = mockFetchResponse(
        errorBody("VALID_INVALID_FORMAT", "kind 'federated' is not supported in v1"),
        400,
      );
      vi.stubGlobal("fetch", mockFetch);

      const err = await client.invitations
        .create({ email: "x@example.com", kind: "federated" })
        .catch((e) => e);
      expect(err).toBeInstanceOf(EngramError);
      expect((err as EngramError).statusCode).toBe(400);
    });

    it("throws ResponseShapeError when the one-time reveal is missing", async () => {
      // The reveal is never re-fetchable — a body without it must fail loudly,
      // not return `reveal: undefined` and silently lose the token forever.
      const bad = mockFetchResponse(enveloped({ invitation: pendingInvitation }), 201);
      vi.stubGlobal("fetch", bad);

      await expect(
        client.invitations.create({ email: "x@example.com" }),
      ).rejects.toBeInstanceOf(ResponseShapeError);
      expect(bad).toHaveBeenCalledTimes(1);
    });

    it("throws ResponseShapeError when reveal.token is missing", async () => {
      const bad = mockFetchResponse(
        enveloped({
          invitation: pendingInvitation,
          reveal: { acceptUrl: "https://x.example.com/invite/t" },
        }),
        201,
      );
      vi.stubGlobal("fetch", bad);

      await expect(
        client.invitations.create({ email: "x@example.com" }),
      ).rejects.toBeInstanceOf(ResponseShapeError);
    });

    it("throws ResponseShapeError when the nested invitation summary is drifted", async () => {
      const { state, ...invitationWithoutState } = pendingInvitation;
      void state;
      const bad = mockFetchResponse(
        enveloped({ invitation: invitationWithoutState, reveal: createResponse.reveal }),
        201,
      );
      vi.stubGlobal("fetch", bad);

      await expect(
        client.invitations.create({ email: "x@example.com" }),
      ).rejects.toBeInstanceOf(ResponseShapeError);
    });
  });

  // ==========================================================================
  // get()
  // ==========================================================================

  describe("invitations.get", () => {
    it("GETs a single invitation, unwrapping data.invitation", async () => {
      mockFetch = mockFetchResponse(enveloped({ invitation: pendingInvitation }));
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.invitations.get(INVITATION_ID);

      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:3100/v1/invitations/${INVITATION_ID}`,
        expect.objectContaining({ method: "GET" }),
      );
      expect(result.id).toBe(INVITATION_ID);
      expect(result.tokenPrefix).toBe("inv_c0ff");
      expect(result.bindings).toHaveLength(1);
    });

    it("throws NotFoundError (404 RES_NOT_FOUND) when not found or not visible", async () => {
      mockFetch = mockFetchResponse(errorBody("RES_NOT_FOUND", "Not found"), 404);
      vi.stubGlobal("fetch", mockFetch);

      const err = await client.invitations.get(INVITATION_ID).catch((e) => e);
      expect(err).toBeInstanceOf(NotFoundError);
      expect((err as NotFoundError).code).toBe("RES_NOT_FOUND");
    });

    it("throws ResponseShapeError when data.invitation is missing", async () => {
      const bad = mockFetchResponse(enveloped({}));
      vi.stubGlobal("fetch", bad);

      await expect(client.invitations.get(INVITATION_ID)).rejects.toBeInstanceOf(
        ResponseShapeError,
      );
    });
  });

  // ==========================================================================
  // revoke()
  // ==========================================================================

  describe("invitations.revoke", () => {
    it("DELETEs the invitation and returns the revoked summary", async () => {
      const revoked: InvitationSummary = {
        ...pendingInvitation,
        state: "revoked",
        status: "revoked",
        revokedAt: "2026-07-03T00:00:00.000Z",
      };
      mockFetch = mockFetchResponse(enveloped({ invitation: revoked }));
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.invitations.revoke(INVITATION_ID);

      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:3100/v1/invitations/${INVITATION_ID}`,
        expect.objectContaining({ method: "DELETE" }),
      );
      expect(result.status).toBe("revoked");
      expect(result.revokedAt).toBe("2026-07-03T00:00:00.000Z");
    });

    it("throws a 409 EngramError (INVITE_NOT_PENDING) when not revocable", async () => {
      mockFetch = mockFetchResponse(
        errorBody("INVITE_NOT_PENDING", "Accepted invitations are immutable history"),
        409,
      );
      vi.stubGlobal("fetch", mockFetch);

      const err = await client.invitations.revoke(INVITATION_ID).catch((e) => e);
      expect(err).toBeInstanceOf(EngramError);
      expect((err as EngramError).code).toBe("INVITE_NOT_PENDING");
      expect((err as EngramError).statusCode).toBe(409);
    });
  });

  // ==========================================================================
  // resend()
  // ==========================================================================

  describe("invitations.resend", () => {
    it("POSTs the resend action and returns the NEW one-time reveal", async () => {
      const rotated: InvitationCreateResponse = {
        invitation: { ...pendingInvitation, resendCount: 1 },
        reveal: {
          token: "inv_d00dad.rotated-token",
          acceptUrl: "https://engram.example.com/invite/inv_d00dad.rotated-token",
        },
      };
      mockFetch = mockFetchResponse(enveloped(rotated));
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.invitations.resend(INVITATION_ID);

      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:3100/v1/invitations/${INVITATION_ID}/resend`,
        expect.objectContaining({ method: "POST" }),
      );
      expect(result.invitation.resendCount).toBe(1);
      expect(result.reveal.token).toBe("inv_d00dad.rotated-token");
    });

    it("throws a 409 EngramError (INVITE_NOT_PENDING) when not resendable", async () => {
      mockFetch = mockFetchResponse(errorBody("INVITE_NOT_PENDING", "Not pending"), 409);
      vi.stubGlobal("fetch", mockFetch);

      await expect(client.invitations.resend(INVITATION_ID)).rejects.toMatchObject({
        code: "INVITE_NOT_PENDING",
        statusCode: 409,
      });
    });

    it("throws ResponseShapeError when the rotated reveal is missing", async () => {
      const bad = mockFetchResponse(enveloped({ invitation: pendingInvitation }));
      vi.stubGlobal("fetch", bad);

      await expect(client.invitations.resend(INVITATION_ID)).rejects.toBeInstanceOf(
        ResponseShapeError,
      );
    });
  });

  // ==========================================================================
  // retryBindings()
  // ==========================================================================

  describe("invitations.retryBindings", () => {
    it("POSTs the retry action and returns the refreshed bindings", async () => {
      mockFetch = mockFetchResponse(
        enveloped({ invitationId: INVITATION_ID, bindings: [appliedBinding, refusedBinding] }),
      );
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.invitations.retryBindings(INVITATION_ID);

      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:3100/v1/invitations/${INVITATION_ID}/bindings/retry`,
        expect.objectContaining({ method: "POST" }),
      );
      expect(result.invitationId).toBe(INVITATION_ID);
      expect(result.bindings).toHaveLength(2);
      expect(result.bindings[1].status).toBe("refused");
      expect(result.bindings[1].resolutionReason).toBe("inviter_no_longer_admin");
    });

    it("throws a 409 EngramError when the invitation is not accepted", async () => {
      mockFetch = mockFetchResponse(
        errorBody("INVITE_NOT_PENDING", "Invitation is not accepted"),
        409,
      );
      vi.stubGlobal("fetch", mockFetch);

      await expect(
        client.invitations.retryBindings(INVITATION_ID),
      ).rejects.toMatchObject({ code: "INVITE_NOT_PENDING", statusCode: 409 });
    });

    it("throws ResponseShapeError when a returned binding drops its status", async () => {
      const { status, ...bindingWithoutStatus } = appliedBinding;
      void status;
      const bad = mockFetchResponse(
        enveloped({ invitationId: INVITATION_ID, bindings: [bindingWithoutStatus] }),
      );
      vi.stubGlobal("fetch", bad);

      await expect(
        client.invitations.retryBindings(INVITATION_ID),
      ).rejects.toBeInstanceOf(ResponseShapeError);
    });
  });

  // ==========================================================================
  // listReceived()
  // ==========================================================================

  describe("invitations.listReceived", () => {
    it("GETs /v1/invitations/received and returns items with pagination", async () => {
      mockFetch = mockFetchResponse(paginated([receivedInvitation]));
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.invitations.listReceived();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3100/v1/invitations/received",
        expect.objectContaining({ method: "GET" }),
      );
      expect(result.invitations).toHaveLength(1);
      expect(result.invitations[0].inviter.name).toBe("owen");
      expect(result.total).toBe(1);
      expect(result.hasMore).toBe(false);
    });

    it("serializes limit/offset query params", async () => {
      mockFetch = mockFetchResponse(paginated([]));
      vi.stubGlobal("fetch", mockFetch);

      await client.invitations.listReceived({ limit: 5, offset: 10 });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toBe(
        "http://localhost:3100/v1/invitations/received?limit=5&offset=10",
      );
    });

    it("throws ResponseShapeError when meta.pagination is absent (no silent fallback)", async () => {
      const bad = mockFetchResponse({ success: true, data: [receivedInvitation] });
      vi.stubGlobal("fetch", bad);

      await expect(client.invitations.listReceived()).rejects.toBeInstanceOf(
        ResponseShapeError,
      );
      expect(bad).toHaveBeenCalledTimes(1);
    });

    it("throws ResponseShapeError when the nested inviter is reshaped", async () => {
      const bad = mockFetchResponse(
        paginated([{ ...receivedInvitation, inviter: { id: INVITER_ID } }]),
      );
      vi.stubGlobal("fetch", bad);

      await expect(client.invitations.listReceived()).rejects.toBeInstanceOf(
        ResponseShapeError,
      );
    });

    it("throws ResponseShapeError when bindings is missing", async () => {
      const { bindings, ...withoutBindings } = receivedInvitation;
      void bindings;
      const bad = mockFetchResponse(paginated([withoutBindings]));
      vi.stubGlobal("fetch", bad);

      await expect(client.invitations.listReceived()).rejects.toBeInstanceOf(
        ResponseShapeError,
      );
    });
  });

  // ==========================================================================
  // redeemPreview()  — public / token-addressed
  // ==========================================================================

  describe("invitations.redeemPreview", () => {
    it("GETs the preview, URL-encoding the token, and unwraps data.invitation", async () => {
      mockFetch = mockFetchResponse(enveloped({ invitation: redeemPreview }));
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.invitations.redeemPreview("tok/with special+chars");

      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:3100/v1/invitations/redeem/${encodeURIComponent("tok/with special+chars")}`,
        expect.objectContaining({ method: "GET" }),
      );
      expect(result.state).toBe("pending");
      expect(result.inviterDisplayName).toBe("Owen");
      expect(result.groups[0].groupId).toBe(GROUP_ID);
    });

    it("throws NotFoundError (404 RES_NOT_FOUND) for an unknown token", async () => {
      mockFetch = mockFetchResponse(errorBody("RES_NOT_FOUND", "No such token"), 404);
      vi.stubGlobal("fetch", mockFetch);

      const err = await client.invitations.redeemPreview(TOKEN).catch((e) => e);
      expect(err).toBeInstanceOf(NotFoundError);
      expect((err as NotFoundError).code).toBe("RES_NOT_FOUND");
    });

    it("throws GoneError (410 INVITE_EXPIRED) for a dead token — typed, not bare EngramError", async () => {
      mockFetch = mockFetchResponse(
        errorBody("INVITE_EXPIRED", "Token expired", { state: "expired" }),
        410,
      );
      vi.stubGlobal("fetch", mockFetch);

      const err = await client.invitations.redeemPreview(TOKEN).catch((e) => e);
      expect(err).toBeInstanceOf(GoneError);
      expect((err as GoneError).code).toBe("INVITE_EXPIRED");
      expect((err as GoneError).statusCode).toBe(410);
      expect((err as GoneError).details).toMatchObject({ state: "expired" });
    });

    it("throws ResponseShapeError when a preview group is reshaped", async () => {
      const bad = mockFetchResponse(
        enveloped({
          invitation: { ...redeemPreview, groups: [{ name: "platform-team" }] },
        }),
      );
      vi.stubGlobal("fetch", bad);

      await expect(client.invitations.redeemPreview(TOKEN)).rejects.toBeInstanceOf(
        ResponseShapeError,
      );
    });

    it("throws ResponseShapeError when a nullable preview field is ABSENT", async () => {
      const { instanceName, ...withoutInstanceName } = redeemPreview;
      void instanceName;
      const bad = mockFetchResponse(enveloped({ invitation: withoutInstanceName }));
      vi.stubGlobal("fetch", bad);

      await expect(client.invitations.redeemPreview(TOKEN)).rejects.toBeInstanceOf(
        ResponseShapeError,
      );
    });
  });

  // ==========================================================================
  // accept()  — public / token-addressed
  // ==========================================================================

  describe("invitations.accept", () => {
    it("POSTs the accept body and returns user + one-time key + bindings", async () => {
      mockFetch = mockFetchResponse(enveloped(acceptResponse));
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.invitations.accept(TOKEN, {
        name: "casey",
        displayName: "Casey",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:3100/v1/invitations/redeem/${encodeURIComponent(TOKEN)}/accept`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ name: "casey", displayName: "Casey" }),
        }),
      );
      expect(result.user.id).toBe(USER_ID);
      expect(result.key.value).toBe("egk_ab12.one-time-secret");
      expect(result.bindings).toHaveLength(2);
    });

    it("throws a typed 400 for an invalid accept body", async () => {
      mockFetch = mockFetchResponse(
        errorBody("VALID_INVALID_FORMAT", "name: must match ^[a-zA-Z][a-zA-Z0-9-]*$"),
        400,
      );
      vi.stubGlobal("fetch", mockFetch);

      const err = await client.invitations
        .accept(TOKEN, { name: "9-bad-handle" })
        .catch((e) => e);
      expect(err).toBeInstanceOf(EngramError);
      expect((err as EngramError).code).toBe("VALID_INVALID_FORMAT");
      expect((err as EngramError).statusCode).toBe(400);
    });

    it("throws NotFoundError for an unknown token (404)", async () => {
      mockFetch = mockFetchResponse(errorBody("RES_NOT_FOUND", "No such token"), 404);
      vi.stubGlobal("fetch", mockFetch);

      await expect(
        client.invitations.accept(TOKEN, { name: "casey" }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("throws a 409 EngramError (INVITE_NAME_TAKEN) — token NOT consumed, retry with another name", async () => {
      mockFetch = mockFetchResponse(
        errorBody("INVITE_NAME_TAKEN", "Handle 'casey' is taken"),
        409,
      );
      vi.stubGlobal("fetch", mockFetch);

      const err = await client.invitations
        .accept(TOKEN, { name: "casey" })
        .catch((e) => e);
      expect(err).toBeInstanceOf(EngramError);
      expect(err).not.toBeInstanceOf(GoneError);
      expect((err as EngramError).code).toBe("INVITE_NAME_TAKEN");
      expect((err as EngramError).statusCode).toBe(409);
    });

    it("throws GoneError (410) for a consumed token", async () => {
      mockFetch = mockFetchResponse(
        errorBody("INVITE_ALREADY_ACCEPTED", "Token already accepted"),
        410,
      );
      vi.stubGlobal("fetch", mockFetch);

      const err = await client.invitations
        .accept(TOKEN, { name: "casey" })
        .catch((e) => e);
      expect(err).toBeInstanceOf(GoneError);
      expect((err as GoneError).code).toBe("INVITE_ALREADY_ACCEPTED");
    });

    it("throws ResponseShapeError when key.value (the one-time secret) is missing", async () => {
      // key.value is never re-fetchable — a body without it must fail loudly,
      // not hand the caller an undefined credential.
      const bad = mockFetchResponse(
        enveloped({
          ...acceptResponse,
          key: { id: "key-1", name: "casey-default", prefix: "egk_ab12" },
        }),
      );
      vi.stubGlobal("fetch", bad);

      await expect(
        client.invitations.accept(TOKEN, { name: "casey" }),
      ).rejects.toBeInstanceOf(ResponseShapeError);
      expect(bad).toHaveBeenCalledTimes(1);
    });

    it("throws ResponseShapeError when the nested user is reshaped", async () => {
      const bad = mockFetchResponse(
        enveloped({ ...acceptResponse, user: { id: USER_ID } }),
      );
      vi.stubGlobal("fetch", bad);

      await expect(
        client.invitations.accept(TOKEN, { name: "casey" }),
      ).rejects.toBeInstanceOf(ResponseShapeError);
    });

    it("throws ResponseShapeError when bindings is not an array", async () => {
      const bad = mockFetchResponse(
        enveloped({ ...acceptResponse, bindings: "applied" }),
      );
      vi.stubGlobal("fetch", bad);

      await expect(
        client.invitations.accept(TOKEN, { name: "casey" }),
      ).rejects.toBeInstanceOf(ResponseShapeError);
    });
  });

  // ==========================================================================
  // decline()  — public / token-addressed
  // ==========================================================================

  describe("invitations.decline", () => {
    it("POSTs the decline action and returns { declined: true }", async () => {
      mockFetch = mockFetchResponse(enveloped({ declined: true }));
      vi.stubGlobal("fetch", mockFetch);

      const result = await client.invitations.decline(TOKEN);

      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:3100/v1/invitations/redeem/${encodeURIComponent(TOKEN)}/decline`,
        expect.objectContaining({ method: "POST" }),
      );
      expect(result.declined).toBe(true);
    });

    it("throws a 409 EngramError (INVITE_NOT_PENDING) after losing a terminal race", async () => {
      mockFetch = mockFetchResponse(
        errorBody("INVITE_NOT_PENDING", "Lost a race to another terminal transition"),
        409,
      );
      vi.stubGlobal("fetch", mockFetch);

      await expect(client.invitations.decline(TOKEN)).rejects.toMatchObject({
        code: "INVITE_NOT_PENDING",
        statusCode: 409,
      });
    });

    it("throws GoneError (410) for an already-dead token", async () => {
      mockFetch = mockFetchResponse(errorBody("INVITE_REVOKED", "Token revoked"), 410);
      vi.stubGlobal("fetch", mockFetch);

      await expect(client.invitations.decline(TOKEN)).rejects.toBeInstanceOf(GoneError);
    });

    it("throws ResponseShapeError when declined is not literally true", async () => {
      const bad = mockFetchResponse(enveloped({ declined: false }));
      vi.stubGlobal("fetch", bad);

      await expect(client.invitations.decline(TOKEN)).rejects.toBeInstanceOf(
        ResponseShapeError,
      );
    });
  });

  // ==========================================================================
  // Credential-less redeem — the token is the credential
  // ==========================================================================

  describe("credential-less redeem (bare client, no apiKey/userId)", () => {
    let bareClient: EngramClient;

    beforeEach(() => {
      bareClient = new EngramClient({
        baseUrl: "http://localhost:3100",
        timeout: 5000,
        retries: 1,
      });
    });

    function sentHeaders(): Record<string, string> {
      return (mockFetch.mock.calls[0][1] as { headers: Record<string, string> }).headers;
    }

    it("redeemPreview sends NO X-API-Key / X-User-ID headers", async () => {
      mockFetch = mockFetchResponse(enveloped({ invitation: redeemPreview }));
      vi.stubGlobal("fetch", mockFetch);

      await bareClient.invitations.redeemPreview(TOKEN);

      const headers = sentHeaders();
      expect(headers).not.toHaveProperty("X-API-Key");
      expect(headers).not.toHaveProperty("X-User-ID");
    });

    it("accept sends NO auth headers and still succeeds", async () => {
      mockFetch = mockFetchResponse(enveloped(acceptResponse));
      vi.stubGlobal("fetch", mockFetch);

      const result = await bareClient.invitations.accept(TOKEN, { name: "casey" });

      const headers = sentHeaders();
      expect(headers).not.toHaveProperty("X-API-Key");
      expect(headers).not.toHaveProperty("X-User-ID");
      expect(result.key.value).toBe("egk_ab12.one-time-secret");
    });

    it("decline sends NO auth headers", async () => {
      mockFetch = mockFetchResponse(enveloped({ declined: true }));
      vi.stubGlobal("fetch", mockFetch);

      await bareClient.invitations.decline(TOKEN);

      const headers = sentHeaders();
      expect(headers).not.toHaveProperty("X-API-Key");
      expect(headers).not.toHaveProperty("X-User-ID");
    });

    it("contrast: a configured client DOES send X-API-Key on the authenticated routes", async () => {
      mockFetch = mockFetchResponse(paginated([]));
      vi.stubGlobal("fetch", mockFetch);

      await client.invitations.list();

      const headers = sentHeaders();
      expect(headers).toHaveProperty("X-API-Key", "test-api-key");
    });
  });
});
