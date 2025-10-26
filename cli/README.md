# Merits CLI

Command-line interface for Merits messaging system with KERI authentication.

## Quick Start

```bash
# Run all checks (tests + coverage) - default target
make

# Or explicitly
make check

# Run tests only
make test

# View help
make help
```

## Development

### Available Make Targets

- **`make`** or **`make check`** - Run tests + coverage report (default)
- **`make test`** - Run CLI unit tests
- **`make coverage`** - Generate HTML coverage report
- **`make typecheck`** - Type check (currently informational)
- **`make install`** - Install dependencies
- **`make clean`** - Remove generated files
- **`make summarise`** - Generate CLI summary and copy to clipboard
- **`make help`** - Show available targets

### Test Results

Current test coverage (Milestone 0):
- **41/41 tests passing** (100% success rate)
- **85.3% line coverage** overall
- **100% coverage** on config.ts
- **95.65% coverage** on OSKeychainVault.ts
- **86.71% coverage** on formatters.ts

### Project Structure

```
cli/
├── Makefile              # Development tasks
├── README.md            # This file
├── index.ts             # CLI entry point
├── lib/
│   ├── config.ts        # Configuration management
│   ├── context.ts       # CLI context
│   ├── formatters.ts    # Output formatters
│   ├── getAuthProof.ts  # Auth helper
│   └── vault/
│       ├── index.ts            # Vault factory
│       ├── MeritsVault.ts      # Vault interface
│       └── OSKeychainVault.ts  # OS Keychain implementation
└── tests/
    └── cli/unit/
        ├── config.test.ts      # Config tests
        ├── formatters.test.ts  # Formatter tests
        └── vault.test.ts       # Vault tests
```

## Usage

### Running the CLI

```bash
# From project root
bun run cli

# Show help
bun run cli --help

# Example commands (Milestone 1+)
bun run cli identity new alice
bun run cli identity list
bun run cli send --to bob --message "Hello!"
```

### Global Options

- `--format <json|text|compact>` - Output format (default: text)
- `--verbose` - Show detailed envelope data
- `--from <identity>` - Identity to use
- `--config <path>` - Config file path
- `--convex-url <url>` - Convex deployment URL
- `--no-color` - Disable colored output
- `--debug` - Enable debug logging

## Implementation Status

### ✅ Milestone 0 (Complete)

- [x] CLI framework (Commander.js)
- [x] MeritsVault interface
- [x] OSKeychainVault implementation
- [x] Config management (4-layer precedence)
- [x] Output formatters (JSON/text/compact)
- [x] Auth helper (`getAuthProof`)
- [x] Unit tests with 100% pass rate

### 🚧 Milestone 1 (Next)

- [ ] `identity new` - Generate new identity
- [ ] `identity list` - List all identities
- [ ] `identity show` - Show identity details
- [ ] `identity export` - Export private key
- [ ] `identity delete` - Delete identity
- [ ] Key rotation ceremony

### 📋 Milestone 2

- [ ] `send` - Send message
- [ ] `receive` - Receive messages
- [ ] Message encryption/decryption

### 📋 Milestone 3

- [ ] `watch` - Watch for incoming messages
- [ ] `group create` - Create group
- [ ] `group` commands - Group management
- [ ] Session tokens

## Architecture

### Vault Design

The vault uses a **pluggable architecture** with OS-native credential storage:

- **Primary**: OS Keychain (macOS/Linux/Windows)
- **Metadata**: `~/.merits/identities.json` (public data, 0600 permissions)
- **Principle**: Private keys never leave the vault
- **Caching**: Lazy-loaded metadata to reduce file I/O

### Config Management

4-layer precedence (highest to lowest):
1. CLI flags
2. Environment variables (`CONVEX_URL`, `MERITS_*`, `NO_COLOR`)
3. Config file (`~/.merits/config.json`)
4. Built-in defaults

### Auth Flow

1. Issue challenge via `client.identity.issueChallenge()`
2. Sign payload with vault (key stays in vault)
3. Return `AuthProof` with signature + challenge ID
4. Submit to mutation

## Dependencies

- **commander** - CLI framework
- **chalk** - Colored output
- **keytar** - OS keychain access
- **ajv** + **ajv-formats** - JSON schema validation
- **ora** - Spinners (future use)

## Documentation

- [CLI Design Plan](../docs/cli-plan.md)
- [Roadmap](../docs/roadmap-cli.md)
- [Milestone 0 Details](../docs/cli-phase-1.md)
- [Milestone 0 Complete](../docs/cli-milestone-0-complete.md)

## Contributing

### Adding New Commands

1. Add command definition in `cli/index.ts`
2. Create command handler in `cli/commands/<name>.ts`
3. Use `getContext(opts)` to access config/vault/client
4. Format output with `formatters.ts`
5. Add tests in `tests/cli/unit/<name>.test.ts`

### Running Tests

```bash
# Run tests
make test

# Watch mode (from project root)
cd .. && bun test --watch tests/cli/unit/

# Coverage
make coverage
open ../coverage/html/index.html
```

## License

See project root LICENSE file.
