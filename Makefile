TOOLKIT := scripts/release-toolkit/lib
SUMMARY := . $(TOOLKIT)/common.sh && . $(TOOLKIT)/summary.sh

.DEFAULT_GOAL := help

.PHONY: help install ensure-deps build lint test python-test check clean release-pr publish claudemd-check

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-15s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies
	@$(SUMMARY) && run_summarized generic "pnpm install --frozen-lockfile" .logs/install.log

NODE_MODULES := node_modules/.package-lock.json

$(NODE_MODULES): package.json pnpm-lock.yaml
	@$(SUMMARY) && run_summarized generic "pnpm install --frozen-lockfile" .logs/install.log
	@touch $@

ensure-deps: $(NODE_MODULES) ## Install deps if missing (fast no-op otherwise)

build: ensure-deps ## Build all packages
	@$(SUMMARY) && run_summarized tsc "pnpm run build" .logs/build.log

lint: ensure-deps ## Lint and typecheck
	@$(SUMMARY) && run_summarized tsc "pnpm run lint" .logs/lint.log

test: ensure-deps ## Run tests
	@$(SUMMARY) && run_summarized vitest "pnpm run test" .logs/test.log

# Fingerprint of the exact tree state (HEAD + staged/unstaged changes).
# `check` records it; `publish` asserts it matches the current tree right
# before shipping, so nothing reaches npm without lint+test having passed
# against the exact code being published. `publish` runs `$(MAKE) check`
# itself (a sub-make, immune to a `-o check` skip on the outer invocation),
# then asserts the stamp — defending against a stale or hand-faked stamp.
CHECK_STAMP := .logs/.check-stamp
TREE_FINGERPRINT := { git rev-parse HEAD; git status --porcelain; git diff HEAD; } | git hash-object --stdin

python-test: ## Run the sdk-python core unit suite (mocked transport)
	@$(SUMMARY) && run_summarized generic "./scripts/run-python-tests.sh" .logs/python-test.log

check: lint test python-test claudemd-check ## Run full CI gate (lint + test + python + docs drift)
	@mkdir -p .logs && $(TREE_FINGERPRINT) > $(CHECK_STAMP)

clean: ## Remove build artifacts
	@rm -rf .logs
	pnpm run clean

# Release flow (standards/release-conventions.md, Mechanism A — Changesets):
# the version bump rides a PR (release-pr); publish ships only what main
# already says (publish). Neither target ever pushes content to main —
# publish's only write to the repo is tags. This replaces the pre-standard
# shape where `publish` ran `changeset version` + committed + pushed the
# version commit to main in one atomic recipe (which put a version commit
# on main without review, violating the PR-only-main rule).

release-pr: ensure-deps ## Open a release PR: changeset version on a branch (the bump half)
	@# The bump half of the flow. Consumes pending changesets on a branch
	@# off origin/main, then opens a PR so the exact versions being
	@# released pass through review like any other change. This never
	@# touches main directly and never publishes.
	@git fetch --quiet origin main
	@if [ -n "$$(git status --porcelain)" ]; then \
		echo "❌ Working tree is not clean. Refusing to build a release PR."; \
		exit 1; \
	fi
	@# `changeset version` with no pending changesets is a no-op that
	@# produces an empty release PR — refuse early. The README.md file is
	@# not a changeset, so exclude it from the count.
	@if ! ls .changeset/*.md 2>/dev/null | grep -qv 'README\.md'; then \
		echo "❌ No changesets to release (.changeset/ has no bump files)."; \
		exit 1; \
	fi
	@# Capture the ref we started on and restore it however we exit —
	@# success, a failed version bump, or a failed `gh pr create` — so a
	@# partial run never strands the operator on the release branch.
	@#
	@# A FAILED restore is the exact condition the trap exists to prevent,
	@# so it must be loud, not swallowed by `|| true`: git's own error is
	@# left on stderr, the recipe prints the manual fix, and the target
	@# exits non-zero. The trap captures the status it was entered with
	@# ($$st) and exits with it, so a restore failure can only turn a
	@# success into a failure — it never masks the original cause with its
	@# own exit code. `exit` is the LAST thing the trap does: any cleanup
	@# added later must go BEFORE the restore, or it will not run.
	@restore_orig() { \
		git checkout --quiet "$$1" && return 0; \
		echo "❌ failed to restore the original ref '$$1' — you are still on the release branch. Restore it by hand: git checkout $$1" >&2; \
		return 1; \
	}; \
	ORIG=$$(git symbolic-ref -q --short HEAD || git rev-parse HEAD); \
	trap 'st=$$?; restore_orig "$$ORIG" || { [ "$$st" -eq 0 ] && st=1; }; exit $$st' EXIT INT TERM; \
	BR=release/version-packages-$$(git rev-parse --short origin/main); \
	git checkout -b "$$BR" origin/main || exit 1; \
	pnpm run version-packages || exit 1; \
	git add -A || exit 1; \
	git commit -m "chore(release): version packages" || exit 1; \
	git push -u origin "$$BR" || exit 1; \
	gh pr create --base main \
	  --title "chore(release): version packages" \
	  --body "Release PR produced by \`make release-pr\` (\`pnpm run version-packages\` = \`changeset version\` + CLAUDE.md table sync). Per standards/release-conventions.md (Mechanism A): review, merge, then run \`make publish\` from a clean \`origin/main\` checkout." \
	  || { echo "❌ gh pr create failed — the branch $$BR is pushed; open the PR by hand or delete the branch."; exit 1; }

publish: ## Publish what main already says: guards, ship, tags (publish-only)
	@# The publish half of the flow. Ships exactly what is on origin/main;
	@# it never bumps, commits, or pushes content — its only repo write is
	@# the tags changeset publish creates. Guards run in the order the
	@# standard prescribes. No --quiet on fetch: a silent fetch failure
	@# could let a stale on-main check pass.
	@git fetch origin main
	@if [ -n "$$(git status --porcelain)" ]; then \
		echo "❌ Working tree is not clean. Refusing to publish."; \
		exit 1; \
	fi
	@if [ "$$(git rev-parse HEAD)" != "$$(git rev-parse origin/main)" ]; then \
		echo "❌ HEAD is not origin/main. Refusing to publish."; \
		exit 1; \
	fi
	@# npm auth preflight, before the multi-minute build/check — every gate
	@# runs BEFORE the point of no return, none after
	@# (standards/makefile-conventions.md, publish invariant 2).
	@npm whoami >/dev/null 2>&1 || (echo "❌ Not logged in to npm. Run 'npm login' first." && exit 1)
	@# Build + full check against the exact tree being published (this IS
	@# origin/main — publish does not mutate it, so the pre-bump/post-bump
	@# split that the old atomic target needed no longer applies). The
	@# fingerprint stamp still asserts `make check` ran against this tree.
	$(MAKE) build
	$(MAKE) check
	@# Assert the stamp `check` just wrote matches the tree we are about
	@# to publish. Redundant with the sub-make above in the happy path,
	@# but it is the tripwire against a stale/faked stamp or a tree that
	@# changed between check and publish.
	@current="$$($(TREE_FINGERPRINT))"; stamp="$$(cat $(CHECK_STAMP) 2>/dev/null)"; \
	if [ -z "$$stamp" ] || [ "$$current" != "$$stamp" ]; then \
		echo "❌ 'make check' has not passed against this exact tree. Refusing to publish."; \
		exit 1; \
	fi
ifeq ($(DRY_RUN),1)
	@# Recipe lines run in separate shells, so a plain `exit 0` here
	@# would only end its own line and the recipe would keep going —
	@# the stop must be a make-level conditional.
	@echo "✅ DRY_RUN=1: all pre-publish gates passed; stopping before the registry check, npm, and the tag push."
else
	@# Everything that touches the registry or the remote lives in ONE
	@# shell below, and the whole recipe ends with it. That is deliberate:
	@# recipe lines run in separate shells, so a mid-recipe `exit 0` ends
	@# only its own line and the target keeps going (the gotcha the
	@# DRY_RUN conditional above exists for). The "nothing to publish"
	@# outcome used to be exactly that kind of stop — it announced it was
	@# done and then ran on into npm and `changeset publish` anyway, saved
	@# only by changeset-publish idempotency. It is now a BRANCH inside
	@# one shell, so there is no stop left to get wrong.
	@#
	@# Not-already-published guard (contract rule 3), per package. For
	@# each publishable workspace package, ask the npm registry whether
	@# name@version already exists. A 404 (E404) means unpublished → this
	@# package needs shipping. Any OTHER failure (auth, network) must
	@# ABORT, never be treated as unpublished — guessing "unpublished" on
	@# a network blip would defeat the idempotency the guard exists for.
	@# If every package is already at its on-main version there is nothing
	@# to publish: skip `changeset publish` and fall through to the shared
	@# tag push, so the target stays a clean, re-runnable no-op.
	@#
	@# POINT OF NO RETURN: `pnpm changeset publish` below is the first
	@# irreversible mutation. It is itself idempotent (it skips any
	@# package already on the registry) and the tag push after it is
	@# idempotent too, so a re-run after a partial failure converges.
	@#
	@# Provenance is EXPLICITLY declined: npm provenance attestation
	@# requires a supported CI OIDC provider (GitHub Actions / GitLab CI)
	@# and cannot be generated by a local publish. The Actions release
	@# workflow that set NPM_CONFIG_PROVENANCE=true was archived in
	@# cef5ad7 (see docs/archive/2026-03-29-github-actions-release.yml).
	@# DEFERRED: restore attestation when a CI publisher returns.
	@# See RELEASING.md "Provenance" for details.
	@#
	@# Tags ONLY, and ONLY this release's tags — never --tags. The release
	@# content is already on main (it merged as the release PR); publish just
	@# tags it and never pushes the main branch. --tags ships every local tag,
	@# so a stale/diverged local tag (an old version on an older commit) fails
	@# the publish AFTER the packages shipped (release-toolkit#39 /
	@# workspace#201; monorepo analogue of test-kit#37). Push exactly the tags
	@# at the release commit (HEAD == origin/main here): idempotent same-SHA
	@# no-op; a diverged release tag fails loud; an empty set is a loud no-op,
	@# never a bare `git push origin`. One tag push serves both branches — the
	@# no-op path exists to ensure the tags landed, and the shipped path pushes
	@# the tags changeset just created.
	@needs_publish=0; \
	err=$$(mktemp) || { echo "❌ mktemp failed — cannot run the registry check."; exit 1; }; \
	trap 'rm -f "$$err"' EXIT INT TERM; \
	for pkg in $$(node -e 'const fs=require("fs");for(const d of fs.readdirSync("packages")){const f="packages/"+d+"/package.json";if(!fs.existsSync(f))continue;const p=JSON.parse(fs.readFileSync(f,"utf8"));if(p.private||!p.name||!p.version)continue;console.log(p.name+"@"+p.version);}'); do \
		out=$$(npm view "$$pkg" version 2>"$$err"); rc=$$?; \
		if [ $$rc -ne 0 ]; then \
			if grep -q 'E404' "$$err" || grep -q 'code E404' "$$err"; then \
				echo "  will publish: $$pkg (not on registry)"; \
				needs_publish=1; continue; \
			fi; \
			echo "❌ Registry check failed for $$pkg (auth/network, not a 404) — refusing to guess:"; \
			cat "$$err"; exit 1; \
		fi; \
		echo "  already published: $$pkg"; \
	done; \
	if [ "$$needs_publish" -eq 0 ]; then \
		echo "✅ All package versions on origin/main are already published — nothing to publish. Ensuring this release tags are pushed."; \
	else \
		: 'POINT OF NO RETURN'; \
		NPM_CONFIG_PROVENANCE=false pnpm changeset publish || exit 1; \
	fi; \
	TAGS="$$(git tag --points-at HEAD)"; \
	if [ -n "$$TAGS" ]; then \
		REFSPECS=''; for t in $$TAGS; do REFSPECS="$$REFSPECS refs/tags/$$t:refs/tags/$$t"; done; \
		git push origin $$REFSPECS || { echo "❌ failed to push release tags ($$TAGS) — diverged remote tag? Fix it on origin, then re-run make publish (idempotent: it no-ops the publish and retries the tags)." >&2; exit 1; }; \
		echo "✅ pushed release tags: $$TAGS"; \
	else \
		echo "✅ publish complete — no tags point at the release commit (HEAD), nothing to push."; \
	fi
endif

claudemd-check: ## Check CLAUDE.md package table matches actual versions
	@./scripts/check-claudemd-versions.sh

# Changelog
# 2026-04-04  Add build summary (run_summarized via release-toolkit)
# 2026-04-14  Make `publish` target idempotent on already-versioned state
# 2026-04-15  Add claudemd-check target + RELEASING.md
# 2026-04-16  Add npm auth preflight check to `publish` target
# 2026-04-20  Add ensure-deps sentinel (workspace convention)
# 2026-06-11  Wire claudemd-check into `check`; script also guards resource count
# 2026-06-11  Hard-gate publish on check via tree fingerprint stamp;
#             explicitly decline npm provenance (NPM_CONFIG_PROVENANCE=false)
#             for local publishes — unsupported without a CI OIDC provider
# 2026-06-12  Close the 2.0.0 release-gate gap (next-stage Initiative 1):
#             publish refuses on dirty tree / HEAD != origin/main, version
#             flow syncs CLAUDE.md (pnpm run version-packages), full check
#             re-runs live against the post-bump tree, DRY_RUN=1 stops
#             before version bump and npm for gate testing
# 2026-06-12  Add python-test (sdk-python pytest via scripts/run-python-tests.sh)
#             and wire it into `check` (next-stage Initiative 3, Phase B). Only
#             the .PHONY + check + new python-test lines were touched, to keep
#             the merge with the in-flight publish-target restructure (PR #87)
#             trivial.
# 2026-07-03  Adopt standards/release-conventions.md (Mechanism A). Split the
#             atomic publish into release-pr (bump via PR: version-packages on
#             a branch → commit → push → gh pr create) and a publish-only
#             publish (guards: clean tree, HEAD==origin/main, per-package
#             not-already-published registry check; then build+check+stamp;
#             changeset publish; push TAGS ONLY). publish no longer runs
#             changeset version, commits, or pushes main — its only repo write
#             is tags. Registry check aborts on any non-404 failure and no-ops
#             cleanly when every on-main version is already published, making
#             publish idempotent + re-runnable after a partial failure.
# 2026-07-13  publish: push only this release's per-package tags (git tag
#             --points-at HEAD), never all local tags, at both tag sites.
#             Pushing all tags ships every local tag, so a stale/diverged one
#             (an old version, on an older commit) failed the publish AFTER the
#             packages shipped (release-toolkit#39 / workspace#201; monorepo
#             analogue of the merged test-kit#37 single-tag fix). --points-at
#             HEAD is idempotent (same-SHA no-op), fail-loud on a diverged
#             release tag, immune to unrelated stale local tags; an empty set
#             is a loud no-op rather than a bare `git push origin`.
# 2026-07-23  publish: the "nothing to publish" no-op no longer relies on a
#             mid-recipe `exit 0` (#161). Recipe lines run in separate shells,
#             so that exit ended only its own line — the target ran on into
#             npm whoami, build, check, the stamp assert and `changeset
#             publish`, and the "nothing to publish" message overstated what
#             happened. The registry check now runs LAST, inside the same
#             single shell as `changeset publish` and the tag push, so the
#             no-op is a branch rather than a stop: gates (fetch, clean tree,
#             HEAD==origin/main, npm auth) → build → check → stamp assert →
#             [registry check → publish-or-skip → push this release's tags].
#             Side effects: DRY_RUN=1 now stops before the registry check too
#             (it previously fell through the no-op branch and PUSHED TAGS
#             before printing "stopping before npm and tag push" — the recipe
#             printed a promise it did not enforce); the duplicated tag-push
#             block is now one shared block; POINT OF NO RETURN is marked.
#             Cost: a no-op re-run now runs build+check before discovering
#             there is nothing to ship (turbo-cached; correctness over speed).
#             release-pr: the ORIG-restore trap no longer swallows failures
#             with `|| true` — a failed restore prints git's error plus the
#             manual fix and fails the target, while preserving the status the
#             trap was entered with so it never masks the original cause.
