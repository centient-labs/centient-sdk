---
"@centient/sdk": minor
---

Add `client.invitations` — the ADR-044 invite/provisioning/connection lifecycle (engram-server >= 0.50.0).

Authenticated (inviter/admin side): `list`, `create`, `get`, `revoke`, `resend`, `retryBindings`, `listReceived`. Public token-addressed (invitee side): `redeemPreview`, `accept`, `decline` — callable from a client constructed with no `apiKey`/`userId` (the token is the credential; the SDK attaches auth headers only when configured).

New types: `InvitationSummary`, `InvitationBinding`, `InvitationCreateResponse`, `InvitationTokenReveal`, `RedeemPreview`, `AcceptInvitationResponse` (`AcceptedUser`/`AcceptedKey`), `ReceivedInvitation`, `CreateInvitationParams`, `AcceptInvitationParams`, plus the distinct `InvitationState` (5 values, incl. derived `expired`) and `InvitationStatus` (4 stored values) enums. `reveal.token` and `key.value` are ONE-TIME secrets (never re-fetchable; `resend` rotates the token) and their guards fail loudly if a response drops them.

New `GoneError` (410) in the `parseApiError` ladder — a dead/expired/consumed invitation token surfaces typed (`instanceof GoneError`, server `INVITE_*` code preserved) instead of a bare `EngramError`.

Every wire field is required in the 0.50.0 schema, so the response guards assert PRESENCE (nullable fields must arrive as explicit `null`); the two lists validate the strict paginated `{ success, data, meta.pagination }` envelope. Requires engram-server >= 0.50.0 (per-feature floor; the client-wide `MIN_SERVER_VERSION` stays 0.31.0).
