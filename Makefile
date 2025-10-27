.PHONY: test test-unit test-integration test-cli test-e2e test-watch test-coverage install dev cli clean summarise summarise-convex

# Run all tests
test: test-unit test-integration

# Unit tests (fast, no Convex dependency)
test-unit:
	@echo "Running unit tests..."
	@bun test ./tests/unit/

# Integration tests (requires Convex)
test-integration:
	@echo "Running integration tests..."
	@if [ ! -f .env.local ]; then \
		echo "Error: .env.local file not found"; \
		echo "Please run 'make dev' first to set up your Convex deployment"; \
		exit 1; \
	fi
	@export $$(grep -v '^#' .env.local | sed 's/#.*//g' | xargs) && bun test ./tests/integration/

# CLI unit tests (fast, isolated)
test-cli:
	@echo "Running CLI unit tests..."
	@bun test ./tests/cli/unit/

# E2E CLI tests (requires Convex, uses isolated data dirs)
test-e2e:
	@echo "Running E2E CLI tests..."
	@if [ ! -f .env.local ]; then \
		echo "Error: .env.local file not found"; \
		echo "Please run 'make dev' first to set up your Convex deployment"; \
		exit 1; \
	fi
	@export $$(grep -v '^#' .env.local | sed 's/#.*//g' | xargs) && bun test ./tests/cli/e2e/

# Watch mode for development
test-watch:
	@bun test --watch

# Test coverage report
test-coverage:
	@bun test --coverage

# Install dependencies
install:
	bun install

# Start Convex dev server
dev:
	bunx convex dev

# Run CLI tool
cli:
	@if [ ! -f .env.local ]; then \
		echo "Error: .env.local file not found"; \
		echo "Please run 'make dev' first to set up your Convex deployment"; \
		exit 1; \
	fi
	@export $$(grep -v '^#' .env.local | sed 's/#.*//g' | xargs) && bun run cli

# Clean up generated files
clean:
	rm -rf node_modules
	rm -rf convex/_generated
	rm -rf coverage
	rm -f merits-summary.txt
	rm -f core-summary.txt

# Generate summary of convex files and copy to clipboard
summarise:
	@echo "📝 Generating core summary..."
	@./scripts/summariseCore.sh | pbcopy
	@echo "✅ Summary copied to clipboard"

# Generate summary of convex backend files
summarise-convex:
	@./scripts/summarise.sh
	@cat merits-summary.txt | pbcopy
	@echo "Summary copied to clipboard"
