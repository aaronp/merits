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


### Project Structure

```
cli/
├── Makefile              # Development tasks
├── README.md            # This file
├── index.ts             # CLI entry point
├── commands/
│   ├── init.ts          # First-time setup wizard
│   ├── send.ts          # Send messages (Phase 3)
│   ├── receive.ts       # Receive messages (Phase 3)
│   ├── ack.ts           # Acknowledge messages (Phase 3)
│   └── identity/
│       ├── new.ts       # Create identity
│       ├── list.ts      # List identities
│       ├── show.ts      # Show identity details
│       ├── register.ts  # Register with backend
│       ├── set-default.ts
│       ├── export.ts    # Export for backup
│       ├── import.ts    # Import from backup
│       └── delete.ts    # Delete identity
├── lib/
│   ├── config.ts        # Configuration management
│   ├── context.ts       # CLI context
│   ├── formatters.ts    # Output formatters
│   ├── getAuthProof.ts  # Auth helper (Phase 2+)
│   └── vault/
│       ├── index.ts            # Vault factory
│       ├── MeritsVault.ts      # Vault interface
│       └── OSKeychainVault.ts  # OS Keychain implementation
└── tests/
    └── cli/
        ├── unit/
        │   ├── config.test.ts          # Config tests
        │   ├── formatters.test.ts      # Formatter tests
        │   ├── vault.test.ts           # Vault tests
        │   └── messaging-auth.test.ts  # Messaging auth tests (Phase 3)
        └── integration/
            └── messaging.test.ts        # E2E messaging tests (Phase 3)
```

## Usage

### Running the CLI

```bash
# From project root
bun run cli

# Show help
bun run cli --help

# Example commands
bun run cli init                                           # First-time setup
bun run cli identity new alice                             # Create identity
bun run cli identity list                                  # List identities
bun run cli send <recipient-aid> --message "Hello Bob!"    # Send message
bun run cli receive --plaintext                            # Receive messages
bun run cli receive --plaintext --mark-read                # Receive and ack
bun run cli ack <msg-id> --envelope-hash <hash>            # Acknowledge message
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

### ✅ Phase 1: Identity Management (Complete)

- [x] `identity new` - Generate new identity
- [x] `identity list` - List all identities
- [x] `identity show` - Show identity details
- [x] `identity register` - Register with backend
- [x] `identity set-default` - Set default identity
- [x] `identity export` - Export identity for backup
- [x] `identity import` - Import identity from backup
- [x] `identity delete` - Delete identity
- [x] `init` - First-time setup wizard

### ✅ Phase 2: Backend-Agnostic Architecture (Complete)

- [x] MeritsClient interface (transport, identityAuth, group, identityRegistry)
- [x] Factory pattern for backend selection
- [x] Convex backend implementation
- [x] Config refactored to `backend: { type, url }`
- [x] Vault enhancements (updateMetadata, getPublicKey)

### ✅ Phase 3: Messaging Commands (Complete)

- [x] `send <recipient>` - Send encrypted message
- [x] `receive` - Retrieve and display messages
- [x] `ack <message-id>` - Acknowledge message receipt
- [x] Single-proof auth operations
- [x] JSON mode (silent, scriptable)
- [x] Piping support
- [x] Unit tests (51/51 passing)
- [x] Integration tests

**Note**: Phase 3 encryption is a placeholder (base64). Real encryption deferred to Phase 4.

### 📋 Phase 4: Streaming & Groups (Next)

- [ ] `watch` - Real-time message streaming
- [ ] Real encryption (ECDH-ES + AES-GCM)
- [ ] Public key registry lookup
- [ ] `group create` - Create group
- [ ] `group` commands - Group management
- [ ] Session tokens for batch operations

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

1. Issue challenge via `client.identityAuth.issueChallenge()`
2. Canonicalize payload with `canonicalizeToBytes()`
3. Sign with vault using `vault.signIndexed()` (key never leaves vault)
4. Return `AuthProof` with signature + challenge ID + KSN
5. Submit to backend mutation

**Key Principle**: Private keys NEVER leave the vault. All signing happens inside the vault.

## Dependencies

- **commander** - CLI framework
- **chalk** - Colored output
- **keytar** - OS keychain access
- **ajv** + **ajv-formats** - JSON schema validation
- **ora** - Spinners (future use)

## Documentation

- [CLI Roadmap](../docs/roadmap-cli.md)
- [Phase 1: Identity Management](../docs/cli-phase-1.md)
- [Phase 2: Backend-Agnostic Architecture](../docs/cli-phase-2.md)
- [Phase 3: Messaging Commands](../docs/cli-phase-3.md) ✅ Current
- [Phase 2 Review](../docs/phase2-review.md)

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
