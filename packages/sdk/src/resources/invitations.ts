/**
 * Invitations Resource (engram `/v1/invitations`, ADR-044 — engram-server
 * #1118 / PR #1158).
 *
 * Typed wrappers over the invitation / provisioning / connection lifecycle:
 * the server half of the invite → connect → share flow. Two auth classes on
 * one resource:
 *
 * **Authenticated (inviter / admin side)** — sent with the client's
 * configured `X-API-Key` / `X-User-ID`:
 *   - `list(params?)`        → GET    /v1/invitations              (paginated)
 *   - `create(params)`       → POST   /v1/invitations              (one-time token reveal)
 *   - `get(id)`              → GET    /v1/invitations/:id
 *   - `revoke(id)`           → DELETE /v1/invitations/:id
 *   - `resend(id)`           → POST   /v1/invitations/:id/resend   (NEW one-time token reveal)
 *   - `retryBindings(id)`    → POST   /v1/invitations/:id/bindings/retry
 *   - `listReceived(params?)`→ GET    /v1/invitations/received     (paginated)
 *
 * **Public / token-addressed (invitee side)** — the server exempts the
 * `/v1/invitations/redeem/` prefix from API-key auth: THE TOKEN IS THE
 * CREDENTIAL. Callable from a client constructed with no `apiKey`/`userId`
 * (the invitee has no key yet — the SDK attaches auth headers only when
 * configured, so a bare client sends none):
 *   - `redeemPreview(token)` → GET  /v1/invitations/redeem/:token
 *   - `accept(token, params)`→ POST /v1/invitations/redeem/:token/accept
 *   - `decline(token)`       → POST /v1/invitations/redeem/:token/decline
 *
 * One-time secrets: `reveal.token` (create/resend) and `key.value` (accept)
 * are surfaced exactly ONCE and never re-fetchable — persist them
 * immediately. `resend` rotates the token: the old link dies.
 *
 * **Server floor:** requires engram-server >= 0.50.0 (the SDK's
 * `MIN_SERVER_VERSION` of 0.31.0 is the whole-client floor; this is a
 * per-feature floor like `consolidationEvents` @ 0.41.0). Against an older
 * server these routes 404.
 *
 * Every response uses the standard `{ success, data }` envelope; the two
 * lists use the STRICT paginated `{ success, data: [], meta.pagination }`
 * envelope. Every wire field is REQUIRED in the server schema (nullable
 * fields arrive as explicit `null`, never absent), so the guards here assert
 * PRESENCE — a dropped field is contract drift and throws
 * {@link ResponseShapeError}, never a silently-undefined property
 * (P-no-silent-degradation).
 */

import { ResponseShapeError } from "../errors.js";
import {
  isBoolean,
  isNullableString,
  isNumber,
  isString,
  requireArray,
  requireField,
  requireObject,
  unwrapData,
  unwrapDataObject,
  type JsonObject,
} from "../validate.js";
import type {
  AcceptInvitationParams,
  AcceptInvitationResponse,
  CreateInvitationParams,
  DeclineInvitationResponse,
  InvitationBinding,
  InvitationBindingsRetryResult,
  InvitationCreateResponse,
  InvitationSummary,
  ListInvitationsParams,
  ListReceivedInvitationsParams,
  ReceivedInvitation,
  RedeemPreview,
} from "../types/invitations.js";
import { BaseResource } from "./base.js";

// Re-export the invitation types so consumers can import them alongside the
// resource (and so `resources/index.ts` can surface them).
export type {
  AcceptedKey,
  AcceptedUser,
  AcceptInvitationParams,
  AcceptInvitationResponse,
  CreateInvitationGroupParams,
  CreateInvitationParams,
  DeclineInvitationResponse,
  InvitationBinding,
  InvitationBindingRole,
  InvitationBindingsRetryResult,
  InvitationBindingStatus,
  InvitationCreateResponse,
  InvitationKind,
  InvitationState,
  InvitationStatus,
  InvitationSummary,
  InvitationTokenReveal,
  ListInvitationsParams,
  ListReceivedInvitationsParams,
  ReceivedInvitation,
  ReceivedInvitationInviter,
  RedeemPreview,
  RedeemPreviewGroup,
} from "../types/invitations.js";

const RESOURCE = "invitations";

/** The standard `{ success, data, meta? }` envelope (mirrors sibling resources). */
interface ApiSuccessResponse<T> {
  data: T;
  meta?: {
    pagination?: {
      total?: number;
      limit?: number;
      offset?: number;
      hasMore?: boolean;
    };
  };
}

/**
 * Assert that `obj[key]` is PRESENT (the key exists) and passes `check`.
 *
 * The invitation wire schemas mark every field required — nullable fields
 * arrive as explicit `null`, never absent — so an ABSENT key is contract
 * drift even where `null` is legal. The shared `requireField` cannot see the
 * difference (`obj[key]` is `undefined` either way and `isNullableString`
 * accepts it), so this wrapper adds the `in` presence check first.
 */
function requirePresentField(
  obj: JsonObject,
  key: string,
  check: (v: unknown) => boolean,
  route: string,
): void {
  if (!(key in obj)) {
    throw new ResponseShapeError(
      `Unexpected ${route} response shape (required field "${key}" is absent)`,
      route,
      RESOURCE,
    );
  }
  requireField(obj, key, check, route, RESOURCE);
}

/**
 * Validate the required `meta.pagination` contract on the two list routes and
 * return `{ total, hasMore }`. The invitation list envelopes are STRICT
 * (`total`/`limit`/`hasMore` are required in the schema) — falling back to
 * `data.length` / `false` would silently mask a drifted envelope, mirroring
 * the consolidation-events rationale.
 */
function requirePagination(
  response: ApiSuccessResponse<unknown>,
  route: string,
): { total: number; hasMore: boolean } {
  const meta = requireObject(response.meta, route, RESOURCE);
  const pagination = requireObject(meta.pagination, route, RESOURCE);
  requireField(pagination, "total", isNumber, route, RESOURCE);
  requireField(pagination, "hasMore", isBoolean, route, RESOURCE);
  return {
    total: pagination.total as number,
    hasMore: pagination.hasMore as boolean,
  };
}

/**
 * Shape-guard one `InvitationBinding` (all 6 fields are required on the
 * wire; the nullables arrive as explicit `null`).
 */
function requireBinding(value: unknown, route: string): InvitationBinding {
  const obj = requireObject(value, route, RESOURCE);
  requirePresentField(obj, "groupId", isString, route);
  requirePresentField(obj, "groupName", isNullableString, route);
  requirePresentField(obj, "role", isString, route);
  requirePresentField(obj, "status", isString, route);
  requirePresentField(obj, "resolutionReason", isNullableString, route);
  requirePresentField(obj, "resolvedAt", isNullableString, route);
  return obj as unknown as InvitationBinding;
}

/** Shape-guard a `bindings` array field, validating every element. */
function requireBindings(value: unknown, route: string): InvitationBinding[] {
  return requireArray<unknown>(value, route, RESOURCE).map((b) =>
    requireBinding(b, route),
  );
}

/**
 * Shape-guard one `InvitationSummary` — all 17 fields are required in the
 * server schema, so every one is asserted PRESENT (nullables as explicit
 * `null`), including each nested binding.
 */
function requireInvitationSummary(value: unknown, route: string): InvitationSummary {
  const obj = requireObject(value, route, RESOURCE);
  requirePresentField(obj, "id", isString, route);
  requirePresentField(obj, "kind", isString, route);
  requirePresentField(obj, "email", isString, route);
  requirePresentField(obj, "displayNameHint", isNullableString, route);
  requirePresentField(obj, "message", isNullableString, route);
  requirePresentField(obj, "tokenPrefix", isString, route);
  requirePresentField(obj, "state", isString, route);
  requirePresentField(obj, "status", isString, route);
  requirePresentField(obj, "inviterUserId", isString, route);
  requirePresentField(obj, "createdUserId", isNullableString, route);
  requirePresentField(obj, "expiresAt", isString, route);
  requirePresentField(obj, "createdAt", isString, route);
  requirePresentField(obj, "acceptedAt", isNullableString, route);
  requirePresentField(obj, "revokedAt", isNullableString, route);
  requirePresentField(obj, "declinedAt", isNullableString, route);
  requirePresentField(obj, "resendCount", isNumber, route);
  requireBindings(obj.bindings, route);
  return obj as unknown as InvitationSummary;
}

/**
 * Shape-guard the `{ invitation, reveal }` payload of `create` / `resend`,
 * validating the nested summary AND the one-time reveal (`token`,
 * `acceptUrl`) before the caller ever reads them — a reshaped reveal must
 * throw, not surface as an `undefined` token that is silently lost forever.
 */
function requireCreateResponse(
  data: JsonObject,
  route: string,
): InvitationCreateResponse {
  requireInvitationSummary(data.invitation, route);
  const reveal = requireObject(data.reveal, route, RESOURCE);
  requirePresentField(reveal, "token", isString, route);
  requirePresentField(reveal, "acceptUrl", isString, route);
  return data as unknown as InvitationCreateResponse;
}

/**
 * Invitations Resource — the ADR-044 invite / provisioning / connection
 * lifecycle. Attached as `client.invitations`. Requires engram-server
 * >= 0.50.0.
 *
 * @example
 * ```typescript
 * // Inviter side (authenticated client):
 * const { invitation, reveal } = await client.invitations.create({
 *   email: "new.teammate@example.com",
 *   groups: [{ groupId, role: "member" }],
 * });
 * // reveal.token / reveal.acceptUrl are ONE-TIME — share them now.
 *
 * // Invitee side (bare client — no apiKey; the token is the credential):
 * const invitee = new EngramClient({ baseUrl });
 * const preview = await invitee.invitations.redeemPreview(token);
 * const { user, key } = await invitee.invitations.accept(token, { name: "casey" });
 * // key.value is the ONE-TIME api key — persist it immediately.
 * ```
 */
export class InvitationsResource extends BaseResource {
  // ==========================================================================
  // Authenticated (inviter / admin side)
  // ==========================================================================

  /**
   * List invitations you created (the global admin may pass `all: true` to
   * see every invitation), newest first. `status` filters on the FIVE-state
   * vocabulary — `expired` (derived) included.
   *
   * @param params - optional `{ status, all, limit, offset }`
   * @returns the page of invitations plus the server's `total`/`hasMore` contract fields
   * @throws {ResponseShapeError} on a body that violates the strict paginated
   *   `{ data: [], meta.pagination }` envelope or a drifted summary/binding
   */
  async list(params?: ListInvitationsParams): Promise<{
    invitations: InvitationSummary[];
    total: number;
    hasMore: boolean;
  }> {
    const query = new URLSearchParams();
    if (params?.status !== undefined) query.set("status", params.status);
    if (params?.all !== undefined) query.set("all", String(params.all));
    if (params?.limit !== undefined) query.set("limit", String(params.limit));
    if (params?.offset !== undefined) query.set("offset", String(params.offset));
    const qs = query.toString();
    const path = `/v1/invitations${qs ? `?${qs}` : ""}`;
    const route = `GET ${path}`;
    const response = await this.request<ApiSuccessResponse<InvitationSummary[]>>(
      "GET",
      path,
    );
    const data = requireArray<unknown>(
      unwrapData(response, route, RESOURCE),
      route,
      RESOURCE,
    );
    const invitations = data.map((item) => requireInvitationSummary(item, route));
    return { invitations, ...requirePagination(response, route) };
  }

  /**
   * Create a pending invitation. Any authenticated user may invite; requested
   * group bindings are validated against the INVITER's group-admin rights.
   *
   * **The returned `reveal.token` / `reveal.acceptUrl` are ONE-TIME** — the
   * raw token is never returned again (only `tokenPrefix` appears on
   * subsequent reads). Persist or share them immediately; if lost, use
   * {@link resend} to rotate in a new token.
   *
   * @param params - the invitation to create (`email` required)
   * @throws {ValidationFailedError|EngramError} 400 — validation failed,
   *   unknown group, or `kind: "federated"` (unsupported in v1)
   * @throws {EngramError} 403 (`RES_FORBIDDEN`) — the inviter lacks
   *   group-admin rights on a requested group
   * @throws {ResponseShapeError} on a drifted `{ invitation, reveal }` body
   */
  async create(params: CreateInvitationParams): Promise<InvitationCreateResponse> {
    const path = "/v1/invitations";
    const route = `POST ${path}`;
    const response = await this.request<
      ApiSuccessResponse<InvitationCreateResponse>
    >("POST", path, params);
    return requireCreateResponse(
      unwrapDataObject(response, route, RESOURCE),
      route,
    );
  }

  /**
   * Get one invitation you created (or any, as global admin). Never returns
   * the raw token — only `tokenPrefix`.
   *
   * @param id - the invitation id (UUID)
   * @throws {NotFoundError} 404 (`RES_NOT_FOUND`) — not found OR not visible
   *   to the caller (the server does not leak existence)
   * @throws {ResponseShapeError} on a drifted summary body
   */
  async get(id: string): Promise<InvitationSummary> {
    const path = `/v1/invitations/${encodeURIComponent(id)}`;
    const route = `GET ${path}`;
    const response = await this.request<
      ApiSuccessResponse<{ invitation: InvitationSummary }>
    >("GET", path);
    const data = unwrapDataObject(response, route, RESOURCE);
    return requireInvitationSummary(data.invitation, route);
  }

  /**
   * Revoke a pending invitation — kills the token immediately
   * (`status: "revoked"`). Only `pending` (incl. derived-expired) invitations
   * can be revoked; accepted/declined are immutable history.
   *
   * @param id - the invitation id (UUID)
   * @returns the revoked invitation summary
   * @throws {NotFoundError} 404 (`RES_NOT_FOUND`) — not found or not visible
   * @throws {EngramError} 409 (`INVITE_NOT_PENDING`) — not in a revocable state
   * @throws {ResponseShapeError} on a drifted summary body
   */
  async revoke(id: string): Promise<InvitationSummary> {
    const path = `/v1/invitations/${encodeURIComponent(id)}`;
    const route = `DELETE ${path}`;
    const response = await this.request<
      ApiSuccessResponse<{ invitation: InvitationSummary }>
    >("DELETE", path);
    const data = unwrapDataObject(response, route, RESOURCE);
    return requireInvitationSummary(data.invitation, route);
  }

  /**
   * Rotate the invitation's token and reset its expiry. The OLD link dies
   * immediately; `resendCount` increments; a derived-`expired` invitation is
   * un-expired.
   *
   * **The returned `reveal.token` / `reveal.acceptUrl` are the NEW one-time
   * secret** — revealed once, never re-fetchable (same contract as
   * {@link create}).
   *
   * @param id - the invitation id (UUID)
   * @throws {NotFoundError} 404 (`RES_NOT_FOUND`) — not found or not visible
   * @throws {EngramError} 409 (`INVITE_NOT_PENDING`) — not in a resendable state
   * @throws {ResponseShapeError} on a drifted `{ invitation, reveal }` body
   */
  async resend(id: string): Promise<InvitationCreateResponse> {
    const path = `/v1/invitations/${encodeURIComponent(id)}/resend`;
    const route = `POST ${path}`;
    const response = await this.request<
      ApiSuccessResponse<InvitationCreateResponse>
    >("POST", path);
    return requireCreateResponse(
      unwrapDataObject(response, route, RESOURCE),
      route,
    );
  }

  /**
   * Idempotently re-attempt every non-`applied` group binding on an ACCEPTED
   * invitation, re-validating the INVITER's authority per binding (the
   * invitee can call this too, but can never self-provision access the
   * inviter lacks).
   *
   * @param id - the invitation id (UUID)
   * @returns the refreshed binding set
   * @throws {NotFoundError} 404 (`RES_NOT_FOUND`) — not found or not visible
   * @throws {EngramError} 409 (`INVITE_NOT_PENDING`) — the invitation is not accepted
   * @throws {ResponseShapeError} on a drifted body or binding
   */
  async retryBindings(id: string): Promise<InvitationBindingsRetryResult> {
    const path = `/v1/invitations/${encodeURIComponent(id)}/bindings/retry`;
    const route = `POST ${path}`;
    const response = await this.request<
      ApiSuccessResponse<InvitationBindingsRetryResult>
    >("POST", path);
    const data = unwrapDataObject(response, route, RESOURCE);
    requirePresentField(data, "invitationId", isString, route);
    requireBindings(data.bindings, route);
    return data as unknown as InvitationBindingsRetryResult;
  }

  /**
   * List accepted invitations where YOU are the created principal — the
   * invitee side of the durable connection. Token/prefix are omitted
   * entirely; no status filter exists (the set is definitionally
   * accepted-only).
   *
   * @param params - optional `{ limit, offset }`
   * @returns the page of received invitations plus the server's `total`/`hasMore`
   * @throws {ResponseShapeError} on a body that violates the strict paginated
   *   envelope or a drifted item (nested `inviter` and `bindings` included)
   */
  async listReceived(params?: ListReceivedInvitationsParams): Promise<{
    invitations: ReceivedInvitation[];
    total: number;
    hasMore: boolean;
  }> {
    const query = new URLSearchParams();
    if (params?.limit !== undefined) query.set("limit", String(params.limit));
    if (params?.offset !== undefined) query.set("offset", String(params.offset));
    const qs = query.toString();
    const path = `/v1/invitations/received${qs ? `?${qs}` : ""}`;
    const route = `GET ${path}`;
    const response = await this.request<ApiSuccessResponse<ReceivedInvitation[]>>(
      "GET",
      path,
    );
    const data = requireArray<unknown>(
      unwrapData(response, route, RESOURCE),
      route,
      RESOURCE,
    );
    const invitations = data.map((item) => {
      const obj = requireObject(item, route, RESOURCE);
      requirePresentField(obj, "id", isString, route);
      requirePresentField(obj, "message", isNullableString, route);
      requirePresentField(obj, "acceptedAt", isNullableString, route);
      const inviter = requireObject(obj.inviter, route, RESOURCE);
      requirePresentField(inviter, "id", isString, route);
      requirePresentField(inviter, "name", isNullableString, route);
      requirePresentField(inviter, "displayName", isNullableString, route);
      requireBindings(obj.bindings, route);
      return obj as unknown as ReceivedInvitation;
    });
    return { invitations, ...requirePagination(response, route) };
  }

  // ==========================================================================
  // Public / token-addressed (invitee side) — no API key required
  // ==========================================================================

  /**
   * Preview an invitation for the accept screen. **Public — callable from a
   * credential-less client (no `apiKey`/`userId` configured); the token is
   * the credential.** The SDK attaches auth headers only when configured, so
   * a bare client sends none. Deliberately minimal payload (no `tokenPrefix`,
   * no inviter id).
   *
   * @param token - the raw invitation token from the accept link
   * @throws {NotFoundError} 404 (`RES_NOT_FOUND`) — no such token
   * @throws {GoneError} 410 (`INVITE_*`) — the token is revoked / expired /
   *   declined / already accepted; render the refusal honestly
   * @throws {ResponseShapeError} on a drifted preview body
   */
  async redeemPreview(token: string): Promise<RedeemPreview> {
    const path = `/v1/invitations/redeem/${encodeURIComponent(token)}`;
    const route = `GET ${path}`;
    const response = await this.request<
      ApiSuccessResponse<{ invitation: RedeemPreview }>
    >("GET", path);
    const data = unwrapDataObject(response, route, RESOURCE);
    const preview = requireObject(data.invitation, route, RESOURCE);
    requirePresentField(preview, "state", isString, route);
    requirePresentField(preview, "inviterDisplayName", isNullableString, route);
    requirePresentField(preview, "instanceName", isNullableString, route);
    requirePresentField(preview, "message", isNullableString, route);
    requirePresentField(preview, "displayNameHint", isNullableString, route);
    requirePresentField(preview, "email", isString, route);
    const groups = requireArray<unknown>(preview.groups, route, RESOURCE);
    for (const group of groups) {
      const g = requireObject(group, route, RESOURCE);
      requirePresentField(g, "groupId", isString, route);
      requirePresentField(g, "name", isNullableString, route);
    }
    return preview as unknown as RedeemPreview;
  }

  /**
   * Accept an invitation — "Connected". Atomically materializes the invited
   * principal: user + API key + resolved group bindings. **Public — callable
   * from a credential-less client (no `apiKey`/`userId` configured); the
   * token is the credential.**
   *
   * **The returned `key.value` is the ONE-TIME raw API key** — surfaced once,
   * never re-fetchable (only `key.prefix` is visible afterwards). Persist it
   * immediately; it is the new principal's only credential.
   *
   * @param token - the raw invitation token from the accept link
   * @param params - `{ name }` (required handle, ADR-013 rules) + optional `displayName`
   * @throws {ValidationFailedError|EngramError} 400 — invalid accept body
   * @throws {NotFoundError} 404 (`RES_NOT_FOUND`) — no such token
   * @throws {EngramError} 409 (`INVITE_NAME_TAKEN`) — the chosen handle is
   *   taken; the token is NOT consumed — pick another name and retry
   * @throws {GoneError} 410 (`INVITE_*`) — the token is revoked / expired /
   *   declined / already accepted
   * @throws {ResponseShapeError} on a drifted `{ user, key, bindings }` body
   */
  async accept(
    token: string,
    params: AcceptInvitationParams,
  ): Promise<AcceptInvitationResponse> {
    const path = `/v1/invitations/redeem/${encodeURIComponent(token)}/accept`;
    const route = `POST ${path}`;
    const response = await this.request<
      ApiSuccessResponse<AcceptInvitationResponse>
    >("POST", path, params);
    const data = unwrapDataObject(response, route, RESOURCE);
    const user = requireObject(data.user, route, RESOURCE);
    requirePresentField(user, "id", isString, route);
    requirePresentField(user, "name", isString, route);
    requirePresentField(user, "displayName", isNullableString, route);
    requirePresentField(user, "createdAt", isString, route);
    // The one-time key: a reshaped `key` must throw, not surface an
    // `undefined` value that is silently lost forever (it is never
    // re-fetchable).
    const key = requireObject(data.key, route, RESOURCE);
    requirePresentField(key, "id", isString, route);
    requirePresentField(key, "name", isString, route);
    requirePresentField(key, "prefix", isString, route);
    requirePresentField(key, "value", isString, route);
    requireBindings(data.bindings, route);
    return data as unknown as AcceptInvitationResponse;
  }

  /**
   * Decline an invitation — terminal (distinct from inviter revocation for
   * audit provenance). **Public — callable from a credential-less client (no
   * `apiKey`/`userId` configured); the token is the credential.**
   *
   * @param token - the raw invitation token from the accept link
   * @throws {NotFoundError} 404 (`RES_NOT_FOUND`) — no such token
   * @throws {EngramError} 409 (`INVITE_NOT_PENDING`) — lost a race to another
   *   terminal transition
   * @throws {GoneError} 410 (`INVITE_*`) — the token is already dead
   * @throws {ResponseShapeError} on a drifted body
   */
  async decline(token: string): Promise<DeclineInvitationResponse> {
    const path = `/v1/invitations/redeem/${encodeURIComponent(token)}/decline`;
    const route = `POST ${path}`;
    const response = await this.request<
      ApiSuccessResponse<DeclineInvitationResponse>
    >("POST", path);
    const data = unwrapDataObject(response, route, RESOURCE);
    requirePresentField(data, "declined", (v) => v === true, route);
    return data as unknown as DeclineInvitationResponse;
  }
}
