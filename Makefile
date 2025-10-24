.PHONY: test test-unit test-integration test-watch test-coverage install dev cli clean summarise

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
	rm -f merits-summary.txt

# Generate summary of convex files and copy to clipboard
summarise:
	@./scripts/summarise.sh
	@cat merits-summary.txt | pbcopy
	@echo "Summary copied to clipboard"
