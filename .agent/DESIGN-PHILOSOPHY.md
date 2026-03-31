# Design Philosophy

This document defines the design philosophy for this project. These principles guide architectural decisions, tool implementations, and integration patterns. They exist to produce systems that are **efficient, honest, observable, and resilient**.

The principles are organized into three tiers:

- **Tier 1 — Core Convictions:** Non-negotiable commitments that define what kind of system this is.
- **Tier 2 — Design Principles:** Concrete rules for how tools and APIs should behave.
- **Tier 3 — Operational Constraints:** Guardrails on how the system runs in production.

---

## Tier 1: Core Convictions

These are foundational beliefs. They are not up for trade-off analysis — they are the constraints within which trade-offs are made.

### 1. Root Cause Over Bandaid

Fix underlying problems, not symptoms. Central solutions over per-handler workarounds. When a bug surfaces in one module, ask whether the root cause lives in shared infrastructure. If it does, fix it there — even if the localized patch would be faster.

**Litmus test:** If you're copy-pasting a fix into a second location, you're treating a symptom.

### 2. No Silent Degradation

Errors must be explicit, visible, and actionable at the point they occur. Never silently swallow failures or return empty results that could mean either "nothing found" or "search failed."

This does not mean the system should crash on every edge case. It means: when something goes wrong or falls back to a lower-confidence path, the caller must know. A function that returns `null` when the database is unreachable is lying. A function that returns `{ ok: false, error: { code: "DB_TIMEOUT" } }` is honest.

**Clarification — "silent" is the key word.** This principle prohibits *hiding* degradation, not degradation itself. A system that falls back to a simpler algorithm when the primary fails is fine — as long as the response indicates the fallback path was used (`method: "fallback"`, `confidence: 0.60`). The violation is returning results without indicating they came from a fallback path. See also: P14 (Resilient Under Load) addresses *performance* degradation separately from *accuracy/completeness* degradation governed here.

**Litmus test:** Could a caller distinguish between "no results found" and "operation failed"? If not, the code is hiding information.

### 3. Transparent Evolution

Architecture must grow with the system. Structured data enables future capabilities without rewriting callers. New types, methods, and configurations should slot in centrally, not require touching every handler.

**Litmus test:** Can you add a new type or method without modifying existing handlers?

### 4. Observable Architecture

Avoid patterns that become opaque over time. The system should have the data to observe and improve its own behavior. Architecture that can't observe itself can't improve itself.

**Litmus test:** Can you answer "how well is this feature working?" from production data alone, without asking users?

---

## Tier 2: Design Principles

These translate the core convictions into concrete, testable rules.

### 5. Principle of Least Surprise

Functions and APIs should behave predictably. Same inputs produce same outputs. Side effects are declared, not hidden. When a function transforms input, the response should show what was interpreted — never silently substitute.

**Clarification — relationship to P3 (Transparent Evolution).** Evolution and predictability are not opposed when changes are *structural* rather than *behavioral*. Adding a new type (P3) doesn't change how existing types behave (P5). The rule: **evolve capabilities, preserve contracts.** Existing inputs produce equivalent outputs; new capabilities are additive, not mutative.

**Litmus test:** Would a new developer correctly predict this function's behavior from its name and signature?

### 6. Single Source of Truth

Every fact should live in exactly one place. When two systems disagree, surface the conflict — don't pick a winner silently. Validation happens at system boundaries, not deep inside internal logic. Internal code trusts its own data structures. Trust is established at ingestion, then carried forward.

**Clarification — relationship to P11 (Honest Uncertainty).** "Single source of truth" defines *where* authoritative data lives, not that the data is infallible. The authoritative store may contain data with varying confidence levels. P6 says "don't duplicate the data elsewhere"; P11 says "surface how confident the single source is." One source, with calibrated confidence.

**Litmus test:** Is there a second place where this data is stored or derived independently?

### 7. Progressive Disclosure of Complexity

The simple case should be simple. When ambiguity or edge cases arise, surface increasing levels of detail rather than dumping everything upfront or hiding complexity entirely.

**Clarification — relationship to P2 (No Silent Degradation).** These are not in tension — they govern *what* to disclose vs *how much*. P2 requires that the response always contain enough information for the caller to know whether degradation occurred. P7 says additional detail beyond that minimum should scale with complexity. The rule: **structural transparency is mandatory; verbose detail is proportional to complexity.**

**Rule:** Error codes and method indicators are always present. Alternative/detail fields are populated only when meaningful.

### 8. Idempotency by Default

Read operations must be side-effect-free. Write operations should be safely repeatable — calling a create function with the same input twice shouldn't create duplicates or error opaquely. This is critical for systems where AI agents are callers, because agents may retry on timeout or context limits.

**Clarification — relationship to P2 (No Silent Degradation).** Idempotent no-ops are *not* silent degradation. The distinction: *swallowing an error* violates P2; *recognizing a no-op* satisfies P8. A duplicate write should return success with an explicit signal (`already_exists`). It should NOT return a generic success indistinguishable from a new insert, and it should NOT throw an error for a non-exceptional condition.

**Rule:** Acknowledge the no-op (`already_exists`), don't disguise it as new work, don't treat it as failure.

### 9. Composability Over Completeness

Functions should do one thing well and be combinable. Don't build mega-functions that search, transform, and format in a single call. But don't be gratuitously granular either — batch operations for repeated work are encouraged.

**Clarification — relationship to P12 (Cost-Aware by Design).** More granular functions = more composability = more calls = more cost. The resolution: **distinguish between responsibility boundaries and call boundaries.** Functions maintain single responsibilities (P9), but batch mode allows multiple instances of the same responsibility in one call (P12). The rule: **never merge different responsibilities to save calls; always allow batching of the same responsibility to save calls.**

**Rule:** Never merge different responsibilities to save calls. Always allow batching of the same responsibility to save calls.

### 10. Categorical Symmetry

When multiple concepts share a category, architect for the category, not individual members. If a capability exists for one member of a category, the design must account for all members. Partial implementation across a category creates asymmetry that compounds into bugs, silent gaps, or architectural debt.

This is the proactive complement to P1 (Root Cause Over Bandaid). P1 says "when you find a bug, fix the root cause." This principle says "before you ship, identify the category and build for all of it." P1 is reactive depth; this is proactive breadth.

**Clarification — relationship to P9 (Composability Over Completeness).** "Build for all members" does not mean "build one function that handles everything." Categorical Symmetry requires uniform *treatment* — the same pipeline, the same data contract, the same observability — across all members. Composability still governs function boundaries: different functions can serve different category members as long as they share the same underlying infrastructure and response shape. The rule: **uniform infrastructure, composed through appropriate boundaries.**

**Litmus test:** When building a capability for concept X, can you name the category X belongs to? Have you confirmed the capability applies to every other member of that category?

### 11. Honest Uncertainty

When the system doesn't know something, it should say so. Every response should allow the caller to distinguish between confirmed absence and uncertain absence. Surface confidence when applicable.

This extends P2 (No Silent Degradation) from error paths to *epistemology*: the system should be calibrated about what it knows, what it partially knows, and what it doesn't know at all.

**Litmus test:** Can the caller tell whether "no results" means "confirmed empty" or "couldn't check"?

---

## Tier 3: Operational Constraints

These protect the system's integrity, cost profile, and trustworthiness in production.

### 12. Cost-Aware by Design

Every external API call has a monetary and latency cost. Caching, batch operations, and deduplication are not optimizations — they are requirements. A single user action can fan out to many tool calls; careless design multiplies this further.

### 13. Auditability as a First-Class Feature

Every mutation should be traceable: who requested it, when, what changed, and why. Audit trails are not a compliance afterthought — they are the mechanism by which the system observes and improves itself (connecting back to Conviction 4).

### 14. Resilient Under Load

The system should have known performance envelopes and should communicate when approaching them. Pre-warming, batch size caps, and timeout budgets are expressions of this principle. Never leave a caller hanging without explanation.

### 15. Secure by Default

Read-only is the default posture. Write operations require explicit flows. Credentials are provisioned intentionally — never discovered or borrowed. Validate at boundaries, trust internal data structures.

---

## Principle Tension Resolution

When principles conflict, use these resolution rules:

| Tension | Principles | Resolution |
|---------|-----------|------------|
| "No degradation" vs "resilient under load" | P2 vs P14 | P2 governs **data quality** (never hide fallback paths). P14 governs **performance** (communicate capacity limits). Different domains, both require transparency. |
| "Errors visible" vs "idempotent writes" | P2 vs P8 | Idempotent no-ops are not errors. Return success with `already_exists` — don't disguise as new work, don't treat as failure. |
| "Surface everything" vs "progressive disclosure" | P2 vs P7 | Structural transparency is mandatory (error codes always present). Verbose detail is proportional to complexity. |
| "Composable tools" vs "minimize cost" | P9 vs P12 | Never merge different responsibilities to save calls. Always allow batching of the same responsibility. |
| "Single source" vs "honest uncertainty" | P6 vs P11 | One authoritative store with calibrated confidence. "Single source" means "don't duplicate," not "infallible." |
| "Predictable" vs "evolving" | P5 vs P3 | Evolve capabilities, preserve contracts. Existing inputs produce equivalent outputs; new capabilities are additive. |
| "Build for all members" vs "composable tools" | P10 vs P9 | Categorical Symmetry requires uniform *infrastructure* (same pipeline, same data contract, same observability). Composability governs *boundaries* (separate responsibilities). Symmetric treatment doesn't mean one mega-function — it means shared underlying abstractions composed through appropriate interfaces. |

---

## How to Use This Document

- **Designing a new module:** Walk through Tier 2 (P5-P11). Does it satisfy Least Surprise? Is the write path idempotent? Have you identified the category and built for all members?
- **Writing an ADR:** Reference principles by number. "This aligns with P6 (Single Source of Truth)."
- **Reviewing code:** Check Tier 3. Is there cost awareness? Are mutations auditable? Are batch sizes bounded?
- **Resolving disagreements:** Return to Tier 1. The core convictions are the tiebreakers.
