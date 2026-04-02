.DEFAULT_GOAL := help

.PHONY: help install build lint test check clean publish

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-15s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies
	pnpm install --frozen-lockfile

build: ## Build all packages
	pnpm run build

lint: ## Lint and typecheck
	pnpm run lint

test: ## Run tests
	pnpm run test

check: lint test ## Run full CI gate (lint + test)

clean: ## Remove build artifacts
	pnpm run clean

publish: build check ## Publish to npm via changesets
	pnpm changeset version
	git add -A && git commit -m "chore: version packages"
	pnpm changeset publish
	git push origin main --tags
