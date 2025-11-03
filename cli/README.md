# Merits CLI

Command-line interface for Merits messaging system with KERI authentication.

## Quick Start

```bash
# Build the standalone binary
make build

# Run the CLI
./merits --help
./merits gen-key       # Generate key pair
```

## Development

### Available Make Targets

- **`make build`** - Compile CLI to standalone binary
- **`make test`** - Run CLI unit tests
- **`make coverage`** - Generate HTML coverage report
- **`make check`** - Run tests + coverage (default)
- **`make install`** - Install dependencies
- **`make clean`** - Remove generated files
- **`make help`** - Show available targets

### Project Structure

```
cli/
├── Makefile              # Development tasks
├── README.md            # This file
├── cli.md               # Full CLI documentation
├── index.ts             # CLI entry point
├── commands/            # Command implementations
│   ├── gen-key.ts       # Generate key pair
│   ├── create-user.ts   # Create user challenge
│   ├── sign.ts          # Sign challenge
│   ├── confirm-challenge.ts # Confirm and get session
│   ├── sign-in.ts       # Sign in existing user
│   ├── send.ts          # Send messages (direct & group)
│   ├── unread.ts        # Retrieve messages
│   ├── group.ts         # Group management
│   ├── access.ts        # Access control (allow/deny)
│   └── ...              # Other commands
├── lib/
│   ├── config.ts        # Configuration management
│   ├── vault/           # Secure key storage
│   ├── formatters.ts    # Output formatters
│   └── session.ts       # Session token management
└── tests/
    └── unit/            # CLI unit tests
```

## Documentation

**For complete CLI documentation, see [cli.md](cli.md)**

The full documentation includes:
- Authentication flow (gen-key → create-user → sign → confirm-challenge)
- Sending and receiving messages
- Group messaging
- Access control (allow/deny lists)
- Session token management
- All available commands and options

## Quick Examples

```bash
# Authentication flow
merits gen-key > keys.json
merits create-user --id $(jq -r .aid keys.json) --public-key $(jq -r .publicKey keys.json) > challenge.json
merits sign --file challenge.json --keys keys.json > signed.json
merits confirm-challenge --file signed.json > session.json

# Messaging
merits send <recipient-aid> --message "Hello" --token session.json
merits unread --token session.json
merits mark-as-read --ids <msg-id> --token session.json

# Groups
merits group create "my-team" --token session.json
merits group add <group-id> <member-aid> --token session.json
merits send <group-id> --message "Hello team" --token session.json
```

## Testing

The CLI has comprehensive test coverage:

```bash
# Run all tests
make test

# Run with coverage
make coverage

# Run all checks (tests + coverage)
make check
```

## Global Options

All commands support these global options:

- `--format <json|pretty|raw>` - Output format (default: json)
- `--token <path>` - Session token file path
- `--data-dir <path>` - Data directory (overrides ~/.merits/)
- `--convex-url <url>` - Backend URL
- `--no-color` - Disable colored output
- `--verbose` - Show detailed output
- `--debug` - Enable debug logging

## Building

```bash
# Build standalone binary
make build

# Or from project root
make build-cli
```

This creates a standalone `./merits` executable that includes all dependencies.

## Architecture

The CLI uses:
- **Session tokens** for authentication (no default identity management)
- **Vault system** for secure key storage (OS Keychain or encrypted files)
- **Zero-knowledge group encryption** (backend cannot decrypt)
- **KERI-compatible** authentication with Ed25519 signatures
- **Challenge-response** authentication flow

See [cli.md](cli.md) for architectural details.
