/**
 * Invitations Types (engram `/v1/invitations`, ADR-044 — engram-server #1118 /
 * PR #1158).
 *
 * The invitation / provisioning / connection lifecycle: an inviter creates a
 * token-addressed invitation (optionally pre-binding group memberships), the
 * invitee redeems the token from an UNAUTHENTICATED client (preview → accept
 * or decline), and acceptance atomically materializes the invited principal —
 * user + one-time API key + resolved group bindings ("Connected").
 *
 * Two auth classes:
 *  - **Authenticated (inviter/admin side)** — list/create/get/revoke/resend/
 *    retry-bindings plus the invitee's `listReceived`. Sent with the client's
 *    configured `X-API-Key`/`X-User-ID` as usual.
 *  - **Public (invitee side)** — the three `/v1/invitations/redeem/{token}`
 *    routes carry no API-key requirement server-side: THE TOKEN IS THE
 *    CREDENTIAL. Call them from a client constructed without `apiKey`/`userId`
 *    (the invitee has no key yet).
 *
 * One-time secrets: `InvitationTokenReveal.token` (create/resend) and
 * `AcceptedKey.value` (accept) are revealed exactly ONCE in their responses
 * and are never re-fetchable — persist them immediately. A `resend` rotates
 * the token (the old link dies) and reveals the NEW one once.
 *
 * Every wire shape below is already camelCase and every field is REQUIRED in
 * the server schema (nullable fields arrive as explicit `null`, never absent).
 * Date columns are ISO-8601 strings.
 *
 * **Server floor:** requires engram-server >= 0.50.0. The SDK's
 * `MIN_SERVER_VERSION` floor (0.31.0) is unchanged — this is a per-feature
 * floor (like `consolidationEvents` @ 0.41.0). Against an older server the
 * `/v1/invitations` routes 404.
 */

/**
 * Computed lifecycle state of an invitation — the vocabulary the UI renders
 * (5 values). `expired` is DERIVED, never stored: a row whose stored
 * {@link InvitationStatus} is still `pending` but whose `expiresAt` has
 * passed presents as `expired`. Distinct from {@link InvitationStatus} — do
 * not conflate the two.
 */
export type InvitationState =
  | "pending"
  | "accepted"
  | "revoked"
  | "declined"
  | "expired";

/**
 * Stored lifecycle status of an invitation (4 values). Never contains
 * `expired` — expiry is computed into {@link InvitationState} from
 * `expiresAt`. Distinct from {@link InvitationState} — do not conflate the
 * two.
 */
export type InvitationStatus = "pending" | "accepted" | "revoked" | "declined";

/**
 * Invitation kind. `federated` is reserved for a future cross-instance flow
 * and is REJECTED by the server in v1 (ADR-044 Decision 8) — only `local` is
 * usable today.
 */
export type InvitationKind = "local" | "federated";

/** Role a group binding grants the invited principal. */
export type InvitationBindingRole = "member" | "admin";

/**
 * Durable per-binding provisioning outcome (ADR-044 Decision 5a):
 *  - `pending` — not yet attempted (or awaiting a retry).
 *  - `applied` — the membership was provisioned.
 *  - `refused` — provisioning was refused (see `resolutionReason`, e.g.
 *    `inviter_no_longer_admin`). Retry via `invitations.retryBindings()`.
 */
export type InvitationBindingStatus = "pending" | "applied" | "refused";

/**
 * One group binding attached to an invitation — the group the invited
 * principal is (to be) joined to, with its durable provisioning outcome.
 */
export interface InvitationBinding {
  /** The bound group (UUID). */
  groupId: string;
  /** The group's display name, or `null` when unresolvable. */
  groupName: string | null;
  /** The role the binding grants. */
  role: InvitationBindingRole;
  /** Durable provisioning outcome for this binding. */
  status: InvitationBindingStatus;
  /** Why a `refused` binding was refused (e.g. `inviter_no_longer_admin`), or `null`. */
  resolutionReason: string | null;
  /** ISO-8601 timestamp the binding was resolved, or `null` while `pending`. */
  resolvedAt: string | null;
}

/**
 * An invitation as seen by its inviter (or the global admin). Never carries
 * the raw token — only `tokenPrefix` for list display/support; the full token
 * is revealed once at create/resend time via {@link InvitationTokenReveal}.
 */
export interface InvitationSummary {
  /** Invitation id (UUID). */
  id: string;
  /** Invitation kind (`local` in v1; `federated` is reserved). */
  kind: InvitationKind;
  /** The invitee's email address. */
  email: string;
  /** Suggested display name for the invitee, or `null`. */
  displayNameHint: string | null;
  /** The inviter's message to the invitee, or `null`. */
  message: string | null;
  /** First characters of the token, for list display/support (never the full token). */
  tokenPrefix: string;
  /** Computed lifecycle state (5 values, incl. derived `expired`). */
  state: InvitationState;
  /** Stored lifecycle status (4 values — never `expired`). */
  status: InvitationStatus;
  /** The inviting user (UUID). */
  inviterUserId: string;
  /** The principal materialized on accept (UUID), or `null` before acceptance. */
  createdUserId: string | null;
  /** ISO-8601 expiry timestamp. */
  expiresAt: string;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
  /** ISO-8601 acceptance timestamp, or `null`. */
  acceptedAt: string | null;
  /** ISO-8601 revocation timestamp, or `null`. */
  revokedAt: string | null;
  /** ISO-8601 decline timestamp, or `null`. */
  declinedAt: string | null;
  /** How many times the token has been rotated via resend. */
  resendCount: number;
  /** The invitation's group bindings with their provisioning outcomes. */
  bindings: InvitationBinding[];
}

/**
 * The ONE-TIME token reveal returned by `create` and `resend`.
 *
 * **`token` is surfaced exactly once and is never re-fetchable** — the server
 * stores only a hash. Persist it (or hand the `acceptUrl` to the invitee)
 * immediately; if it is lost, `resend` rotates in a NEW token (killing the
 * old link) and reveals that one once.
 */
export interface InvitationTokenReveal {
  /** The raw invitation token — ONE-TIME; never returned again. */
  token: string;
  /** Ready-to-share acceptance URL embedding the token. */
  acceptUrl: string;
}

/**
 * Response of `invitations.create()` and `invitations.resend()`: the
 * invitation summary plus the one-time token reveal.
 */
export interface InvitationCreateResponse {
  /** The created (or token-rotated) invitation. */
  invitation: InvitationSummary;
  /** The ONE-TIME raw token / acceptance URL — never returned again. */
  reveal: InvitationTokenReveal;
}

/** A requested group binding on `invitations.create()`. */
export interface CreateInvitationGroupParams {
  /** The group to bind (UUID). Validated against the INVITER's group-admin rights. */
  groupId: string;
  /** Role to grant. Defaults to `member` server-side when omitted. */
  role?: InvitationBindingRole;
}

/** Parameters for `invitations.create()`. */
export interface CreateInvitationParams {
  /** The invitee's email address (required, 1..320 chars). */
  email: string;
  /** Suggested display name for the invitee (1..255 chars). */
  displayNameHint?: string;
  /** Message shown to the invitee on the accept screen (<= 2000 chars). */
  message?: string;
  /** Days until the token expires (1..30). Server default applies when omitted. */
  expiresInDays?: number;
  /**
   * Invitation kind. Only `local` is supported in v1 — the server rejects
   * `federated` with a 400 (ADR-044 Decision 8).
   */
  kind?: InvitationKind;
  /**
   * Group bindings to provision on acceptance (<= 50). Each is validated
   * against the INVITER's group-admin rights: 403 if the inviter cannot grant
   * on a group, 400 if the group is missing.
   */
  groups?: CreateInvitationGroupParams[];
}

/** Parameters for `invitations.list()` (inviter side, paginated). */
export interface ListInvitationsParams {
  /**
   * Filter on the five-state vocabulary (incl. derived `expired` —
   * this filters on {@link InvitationState}, not the stored status).
   */
  status?: InvitationState;
  /** Global admin only: `true` lists every invitation, not just the caller's. */
  all?: boolean;
  /** Page size (1..200, server default 50). */
  limit?: number;
  /** Page offset (>= 0). */
  offset?: number;
}

/**
 * Parameters for `invitations.listReceived()` (invitee side, paginated).
 * No status filter exists — the set is definitionally accepted-only.
 */
export interface ListReceivedInvitationsParams {
  /** Page size (1..200, server default 50). */
  limit?: number;
  /** Page offset (>= 0). */
  offset?: number;
}

/** A group entry on the public redeem preview (id + display name only). */
export interface RedeemPreviewGroup {
  /** The group to be joined (UUID). */
  groupId: string;
  /** The group's display name, or `null`. */
  name: string | null;
}

/**
 * The public, token-addressed preview for the accept screen. Deliberately
 * minimal — no `tokenPrefix`, no inviter id, no binding statuses — because it
 * is served WITHOUT authentication (the token is the credential).
 */
export interface RedeemPreview {
  /** Computed lifecycle state — render `expired`/`revoked` honestly. */
  state: InvitationState;
  /** The inviter's display name, or `null`. */
  inviterDisplayName: string | null;
  /** The inviting instance's name, or `null`. */
  instanceName: string | null;
  /** The inviter's message, or `null`. */
  message: string | null;
  /** Suggested display name for the invitee, or `null`. */
  displayNameHint: string | null;
  /** The invitee's email address. */
  email: string;
  /** The groups the invitee would join on acceptance. */
  groups: RedeemPreviewGroup[];
}

/** Parameters for `invitations.accept()`. */
export interface AcceptInvitationParams {
  /**
   * The invitee's chosen handle (required, 2..64 chars, must match
   * `^[a-zA-Z][a-zA-Z0-9-]*$` per ADR-013). A taken handle is a 409
   * `INVITE_NAME_TAKEN` and the token is NOT consumed — pick another and retry.
   */
  name: string;
  /** Display name (1..255 chars). */
  displayName?: string;
}

/** The user materialized by `invitations.accept()`. */
export interface AcceptedUser {
  /** The new user's id (UUID). */
  id: string;
  /** The handle chosen at accept time. */
  name: string;
  /** The display name, or `null`. */
  displayName: string | null;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
}

/**
 * The API key materialized by `invitations.accept()`.
 *
 * **`value` is the ONE-TIME raw key** (mirroring the `POST /v1/users` key
 * contract): it is surfaced exactly once in the accept response and is never
 * re-fetchable — persist it immediately. Only `prefix` is visible afterwards.
 */
export interface AcceptedKey {
  /** Key id. */
  id: string;
  /** Key name. */
  name: string;
  /** Key prefix (the only part visible after this response). */
  prefix: string;
  /** The raw API key — ONE-TIME; never returned again. */
  value: string;
}

/**
 * Response of `invitations.accept()` — "Connected": the materialized user,
 * their one-time API key, and the resolved group bindings, created atomically
 * (ADR-044 Decision 5).
 */
export interface AcceptInvitationResponse {
  /** The materialized principal. */
  user: AcceptedUser;
  /** The one-time API key — `value` is never returned again. */
  key: AcceptedKey;
  /** Per-binding provisioning outcomes (retryable via `retryBindings`). */
  bindings: InvitationBinding[];
}

/** Response of `invitations.decline()` — the decline is terminal. */
export interface DeclineInvitationResponse {
  /** Always `true` on success. */
  declined: true;
}

/** The inviter identity on a received invitation. */
export interface ReceivedInvitationInviter {
  /** The inviter's user id (UUID). */
  id: string;
  /** The inviter's handle, or `null`. */
  name: string | null;
  /** The inviter's display name, or `null`. */
  displayName: string | null;
}

/**
 * The invitee side of the durable connection (ADR-044 Decision 7): an
 * accepted invitation where the caller is the created principal. Token and
 * prefix are omitted entirely.
 */
export interface ReceivedInvitation {
  /** Invitation id (UUID). */
  id: string;
  /** Who invited the caller. */
  inviter: ReceivedInvitationInviter;
  /** The inviter's message, or `null`. */
  message: string | null;
  /** ISO-8601 acceptance timestamp, or `null`. */
  acceptedAt: string | null;
  /** Per-binding provisioning outcomes. */
  bindings: InvitationBinding[];
}

/**
 * Response of `invitations.retryBindings()` — the refreshed binding set after
 * idempotently re-attempting every non-`applied` binding (re-validating the
 * INVITER's authority per binding, ADR-044 Decision 5a).
 */
export interface InvitationBindingsRetryResult {
  /** The invitation whose bindings were retried (UUID). */
  invitationId: string;
  /** The refreshed bindings with their updated statuses. */
  bindings: InvitationBinding[];
}
