TOOLKIT := scripts/release-toolkit/lib
SUMMARY := . $(TOOLKIT)/common.sh && . $(TOOLKIT)/summary.sh

.DEFAULT_GOAL := help

.PHONY: help install ensure-deps build lint test check clean publish claudemd-check

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

check: lint test claudemd-check ## Run full CI gate (lint + test + docs drift)

clean: ## Remove build artifacts
	@rm -rf .logs
	pnpm run clean

publish: build check ## Publish to npm via changesets
	@npm whoami >/dev/null 2>&1 || (echo "❌ Not logged in to npm. Run 'npm login' first." && exit 1)
	pnpm changeset version
	git add -A
	@# Only commit when `changeset version` actually produced changes.
	@# When every pending changeset has already been consumed (e.g. the
	@# version bump landed in a prior feature PR), the working tree stays
	@# clean after `changeset version` and a plain `git commit` would
	@# fail with exit 1 — aborting publish+tag-push. Skip the commit in
	@# that case so `changeset publish` still runs.
	git diff --cached --quiet || git commit -m "chore: version packages"
	pnpm changeset publish
	git push origin main --tags

claudemd-check: ## Check CLAUDE.md package table matches actual versions
	@./scripts/check-claudemd-versions.sh

# Changelog
# 2026-04-04  Add build summary (run_summarized via release-toolkit)
# 2026-04-14  Make `publish` target idempotent on already-versioned state
# 2026-04-15  Add claudemd-check target + RELEASING.md
# 2026-04-16  Add npm auth preflight check to `publish` target
# 2026-04-20  Add ensure-deps sentinel (workspace convention)
# 2026-06-11  Wire claudemd-check into `check`; script also guards resource count
