.PHONY: test test-unit test-integration test-cli test-e2e test-watch test-coverage install dev cli build build-cli clean clear-db set-env get-env summarise summarise-convex

# Run all tests
test: test-unit test-integration

# Unit tests (fast, no Convex dependency)
test-unit:
	@echo "Running unit tests..."
	@bun test ./tests/unit/

# Integration tests (requires Convex)
test-integration:
	@echo "Running integration tests..."
	@if [ ! -f .env ]; then \
		echo "Error: .env file not found"; \
		echo "Please run 'make dev' first to set up your Convex deployment"; \
		exit 1; \
	fi
	@export $$(grep -v '^#' .env | sed 's/#.*//g' | xargs) && bun test ./tests/integration/

# CLI unit tests (fast, isolated)
test-cli:
	@echo "Running CLI unit tests..."
	@bun test ./tests/cli/unit/

# E2E CLI tests (requires Convex, uses isolated data dirs)
test-e2e:
	@echo "Running E2E CLI tests..."
	@if [ ! -f .env ]; then \
		echo "Error: .env file not found"; \
		echo "Please run 'make dev' first to set up your Convex deployment"; \
		exit 1; \
	fi
	@export $$(grep -v '^#' .env | sed 's/#.*//g' | xargs) && bun test ./tests/cli/e2e/

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
	@if [ ! -f .env ]; then \
		echo "Error: .env file not found"; \
		echo "Please run 'make dev' first to set up your Convex deployment"; \
		exit 1; \
	fi
	@export $$(grep -v '^#' .env | sed 's/#.*//g' | xargs) && bun run cli

# Build CLI binary
build:
	@cd cli && $(MAKE) build

# Alias for build
build-cli: build

# Clean up generated files
clean:
	rm -rf node_modules
	rm -rf convex/_generated
	rm -rf coverage
	rm -f merits-summary.txt
	rm -f core-summary.txt

# Clear Convex database (requires confirmation)
clear-db:
	@if [ ! -f .env ]; then \
		echo "Error: .env file not found"; \
		echo "Please run 'make dev' first to set up your Convex deployment"; \
		exit 1; \
	fi
	@echo "⚠️  WARNING: This will DELETE ALL DATA from your Convex database!"
	@echo ""
	@export $$(grep -v '^#' .env | sed 's/#.*//g' | xargs) && \
		echo "Deployment: $$CONVEX_DEPLOYMENT" && \
		echo "URL: $$CONVEX_URL"
	@echo ""
	@echo -n "Type 'yes' to confirm: " && \
		read confirm && \
		if [ "$$confirm" = "yes" ]; then \
			export $$(grep -v '^#' .env | sed 's/#.*//g' | xargs) && \
			bunx convex run _dev_utils:clearAllData && \
			echo "" && \
			echo "✅ Database cleared successfully" && \
			echo "" && \
			echo "Note: You may need to run bootstrap again to initialize the system"; \
		else \
			echo "❌ Database clear cancelled"; \
			exit 1; \
		fi

# Set BOOTSTRAP_KEY environment variable in Convex from .env
set-env:
	@if [ ! -f .env ]; then \
		echo "Error: .env file not found"; \
		echo "Please run 'make dev' first to set up your Convex deployment"; \
		exit 1; \
	fi
	@echo "Setting BOOTSTRAP_KEY in Convex deployment..."
	@export $$(grep -v '^#' .env | sed 's/#.*//g' | xargs) && \
		echo "Deployment: $$CONVEX_DEPLOYMENT" && \
		bunx convex env set BOOTSTRAP_KEY "$$BOOTSTRAP_KEY"
	@echo "✅ BOOTSTRAP_KEY set successfully"

# List environment variables set in Convex deployment
get-env:
	@if [ ! -f .env ]; then \
		echo "Error: .env file not found"; \
		echo "Please run 'make dev' first to set up your Convex deployment"; \
		exit 1; \
	fi
	@echo "Listing environment variables for Convex deployment..."
	@export $$(grep -v '^#' .env | sed 's/#.*//g' | xargs) && \
		echo "Deployment: $$CONVEX_DEPLOYMENT" && \
		echo "" && \
		bunx convex env list

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
