<!-- cl-sync src=1547b050 -->
# Plan-Gate Procedure

**Non-trivial work requires a committed, approved plan before a code PR opens.**
This is the cheapest place to catch the costliest failure — an agent confidently
building the wrong thing, caught only at diff review. The plan-gate moves
correction to the **lowest-cost stage**: the plan is reviewed *before* any code is
written (ADR-004 §4, the compound-engineering loop).

Pairs with `procedures/session-kickoff.md` (step 4 grounds the plan in prior
lessons — recall *feeds* the plan) and `procedures/commits.md` / handoff
procedures (the work that follows an approved plan).

## When the gate applies

The gate applies to **non-trivial work** — anything beyond the trivial skip set.
The boundary is the **same one** session-kickoff uses, kept single-source there:

- **Exempt (trivial):** the trivial set defined in `session-kickoff.md` "When
  to skip steps" — that file is the **single source** for the boundary (typo
  fixes, single-line changes); this gate *inherits* it rather than re-defining
  it, so the two never drift. Trivial work goes straight to a code PR; no plan
  required.
- **Gated (non-trivial):** new behavior, a new module or surface, a schema or
  contract change, anything touching multiple files or with a non-obvious
  architecture. If you would have to *decide* how to build it, the decision is
  what the plan captures.

When you are unsure which side a task falls on, it is gated. The plan is cheap;
an unwound wrong-direction build is not.

## What the plan must contain

The plan carries the **crucible-plan shape** (the `/crucible-plan` skill already
produces this; for smaller work, write the four fields by hand):

1. **Objective** — what changes and why, in outcome terms. The success this
   delivers, not the diff.
2. **Proposed architecture** — where it lives, the components/interfaces
   touched, the approach chosen and the alternatives rejected.
3. **Research sources** — the grounding from `session-kickoff.md` step 4: prior
   lessons, past PRs, existing patterns/constraints, ADRs, and any external
   sources. Cite them; "have we solved this before?" answered, not skipped.
4. **Success criteria** — how anyone confirms it works: the tests, the
   acceptance checks, the `make check` gate. Concrete and verifiable.

## Where the plan lives and who approves it

The plan is **committed and reviewable before code** — pick the lightest vehicle
that fits the work:

| Work size | Plan vehicle | Approver |
|-----------|-------------|----------|
| Substantial / multi-wave | `docs/plans/PLAN-<topic>.md` (or a `/crucible-plan` artifact), or a dedicated plan issue | operator, or mbot on the plan issue/doc |
| Moderate non-trivial | the tracking issue's description, carrying the four fields | operator, or mbot on the issue |

Approval happens **at the plan stage**, before the code PR opens — that is the
whole point of the gate. The code PR then **references the approved plan** (link
the issue/doc), so the diff reviewer checks the code against an agreed target
rather than re-deriving intent from the diff.

(*mbot* = the centient-labs maintainer review bot — the same bot that reviews
code PRs reviews the plan issue/doc here; see the maintainer-agent docs in
`support/standards`.)

## Strictness — the default and the open operator call

**Default (this procedure): a convention-level gate.** Non-trivial work is
*expected* to carry an approved plan before its code PR; the reviewer (mbot or
operator) enforces it by norm — a code PR with no referenced, approved plan for
clearly non-trivial work should be sent back to plan first.

It is **not yet machine-enforced**: mbot reviews the output *diff*, and nothing
mechanically blocks a code PR that lacks an approved plan. Hard enforcement
(e.g. mbot or a `make check`-adjacent check that refuses a non-trivial code PR
with no linked approved plan) is a **separate operator decision** — it trades
up-front latency for a guarantee, and it needs a reliable trivial/non-trivial
classifier to avoid taxing genuinely small changes. Treat the convention-level
gate as the default until the operator opts into machine enforcement; the
enforcement timeline lives in the ADR-004 rollout (§Rollout), not here.

**Handling a violation.** Under the convention-level default, the reviewer
bounce *is* the enforcement: a non-trivial code PR with no referenced, approved
plan is sent back to write the plan first, not reviewed on its diff. A repeated
pattern of bypass is the signal to escalate to the operator for hard
enforcement — don't quietly let it become the norm.

## Relationship to the rest of the loop

- **Grounding (ADR-004 §3 / `session-kickoff.md` step 4) feeds the plan** — the
  recall is the plan's "research sources" field, not a separate ritual.
- **The codifier (ADR-004 §2) feeds future grounding** — recurring review
  findings become standing rules the next plan inherits automatically, so the
  plan-gate catches less over time.

## Anti-patterns

- **Opening the code PR first, plan after.** The gate is *before* code by
  definition; a plan written to match an already-built diff has skipped the
  cheap-correction stage entirely.
- **A plan with no success criteria.** Without field 4 there is nothing to
  approve against and nothing to verify the build against — it is a description,
  not a plan.
- **Gating trivial work.** Forcing a four-field plan onto a typo is the noise the
  exemption exists to prevent. Respect the trivial skip set.
- **Ungrounded plans.** A plan whose "research sources" are empty when prior
  lessons exist re-creates the recall-on-demand failure ADR-004 §3 fixes. Ground
  first (`session-kickoff.md` step 4), then plan.
