TOOLKIT := scripts/release-toolkit/lib
SUMMARY := . $(TOOLKIT)/common.sh && . $(TOOLKIT)/summary.sh

.DEFAULT_GOAL := help

.PHONY: help install build lint test check clean publish

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-15s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies
	@$(SUMMARY) && run_summarized generic "pnpm install --frozen-lockfile" .logs/install.log

build: ## Build all packages
	@$(SUMMARY) && run_summarized tsc "pnpm run build" .logs/build.log

lint: ## Lint and typecheck
	@$(SUMMARY) && run_summarized tsc "pnpm run lint" .logs/lint.log

test: ## Run tests
	@$(SUMMARY) && run_summarized vitest "pnpm run test" .logs/test.log

check: lint test ## Run full CI gate (lint + test)

clean: ## Remove build artifacts
	@rm -rf .logs
	pnpm run clean

publish: build check ## Publish to npm via changesets
	pnpm changeset version
	git add -A && git commit -m "chore: version packages"
	pnpm changeset publish
	git push origin main --tags

# Changelog
# 2026-04-04  Add build summary (run_summarized via release-toolkit)
