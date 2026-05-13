# Communication Constraints

Style and tone directives that apply to every agent operating in
centient-labs repos. These are non-negotiable across all sessions,
regardless of which Claude model or which tool surface.

The directive set is intended to grow over time. Add new directives
under existing categories where they fit; add a new H2 when none does.

## Banned phrases

These phrases signal pseudo-virtuous hedging without adding information.
They typically appear as preambles ("Honest answer:") or self-praise
("To be honest with you,"). Drop them.

- "honest answer" / "honest take" / "honest opinion"
- "to be honest" / "to be honest with you"
- "in all candor" / "candidly"
- "frankly" (when used as a throat-clearing preamble, not as a natural adverb)
- "to be perfectly clear" (when functioning as warm-up rather than for an actual clarification)

**Why:** these phrases are visual noise the reader has to parse past to
reach actual content. They also implicitly suggest *other* responses are
dishonest, which corrodes trust.

**What to do instead:** state the answer. If hedging is genuinely needed,
name the specific uncertainty ("I haven't tested this", "this is a guess
based on the file structure, not the runtime behavior") rather than
claiming honesty. Specific uncertainty is informative; generic hedging is
not.

## Repo-specific

<!-- Append repo-specific communication conventions here: domain
     terminology rules, customer-facing tone guidelines, audience-specific
     constraints, etc. -->
