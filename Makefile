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
	@BR=release/version-packages-$$(git rev-parse --short origin/main); \
	git checkout -b $$BR origin/main && \
	pnpm run version-packages && \
	git add -A && \
	git commit -m "chore(release): version packages" && \
	git push -u origin $$BR && \
	gh pr create --base main \
	  --title "chore(release): version packages" \
	  --body "Release PR produced by \`make release-pr\` (\`pnpm run version-packages\` = \`changeset version\` + CLAUDE.md table sync). Per standards/release-conventions.md (Mechanism A): review, merge, then run \`make publish\` from a clean \`origin/main\` checkout." && \
	git checkout -

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
	@# Not-already-published guard (contract rule 3), per package. For
	@# each publishable workspace package, ask the npm registry whether
	@# name@version already exists. A 404 (E404) means unpublished → this
	@# package needs shipping. Any OTHER failure (auth, network) must
	@# ABORT, never be treated as unpublished — guessing "unpublished" on
	@# a network blip would defeat the idempotency the guard exists for.
	@# If every package is already at its on-main version, there is
	@# nothing to publish: no-op cleanly (still ensure tags are pushed)
	@# so the target is safely re-runnable after a partial failure.
	@needs_publish=0; \
	for pkg in $$(node -e 'const fs=require("fs");for(const d of fs.readdirSync("packages")){const f="packages/"+d+"/package.json";if(!fs.existsSync(f))continue;const p=JSON.parse(fs.readFileSync(f,"utf8"));if(p.private||!p.name||!p.version)continue;process.stdout.write(p.name+"@"+p.version+"\n");}'); do \
		err=$$(mktemp); \
		out=$$(npm view "$$pkg" version 2>$$err); rc=$$?; \
		if [ $$rc -ne 0 ]; then \
			if grep -q 'E404' "$$err" || grep -q 'code E404' "$$err"; then \
				echo "  will publish: $$pkg (not on registry)"; \
				needs_publish=1; rm -f "$$err"; continue; \
			fi; \
			echo "❌ Registry check failed for $$pkg (auth/network, not a 404) — refusing to guess:"; \
			cat "$$err"; rm -f "$$err"; exit 1; \
		fi; \
		rm -f "$$err"; \
		echo "  already published: $$pkg"; \
	done; \
	if [ "$$needs_publish" -eq 0 ]; then \
		echo "✅ All package versions on origin/main are already published — nothing to publish. Ensuring tags are pushed."; \
		git push origin --tags; \
		exit 0; \
	fi
	@# Build + full check against the exact tree being published (this IS
	@# origin/main — publish does not mutate it, so the pre-bump/post-bump
	@# split that the old atomic target needed no longer applies). The
	@# fingerprint stamp still asserts `make check` ran against this tree.
	@npm whoami >/dev/null 2>&1 || (echo "❌ Not logged in to npm. Run 'npm login' first." && exit 1)
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
	@echo "✅ DRY_RUN=1: all pre-publish gates passed; stopping before npm and tag push."
else
	@# Provenance is EXPLICITLY declined: npm provenance attestation
	@# requires a supported CI OIDC provider (GitHub Actions / GitLab CI)
	@# and cannot be generated by a local publish. The Actions release
	@# workflow that set NPM_CONFIG_PROVENANCE=true was archived in
	@# cef5ad7 (see docs/archive/2026-03-29-github-actions-release.yml).
	@# DEFERRED: restore attestation when a CI publisher returns.
	@# See RELEASING.md "Provenance" for details.
	@# changeset publish is itself idempotent (it skips any package
	@# already on the registry); the guard above is the pre-flight that
	@# makes the whole target a clean no-op when nothing is left to ship.
	NPM_CONFIG_PROVENANCE=false pnpm changeset publish
	@# Tags ONLY. The release content is already on main (it merged as the
	@# release PR); publish just tags it and never pushes the main branch.
	git push origin --tags
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
