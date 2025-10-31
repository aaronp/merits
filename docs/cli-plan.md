# CLI Migration Plan

Plan to migrate the Merits CLI to match the specification in `cli.md`. This plan covers the entire scope including allow-list controls and group encryption mechanisms.

## Overview

Migrate from current identity-based CLI to the specification in `cli.md`:
- Change default output format to `json` (with `pretty` and `raw` options)
- Adopt exact command names/flags from `cli.md`
- Remove old commands (no aliases)
- Implement session token management and storage
- Add allow-list controls
- Implement group encryption with X25519 key derivation

**Phase Order (Optimized for Dependencies):**
1. Output + Global Options (base)
2. Session Token System (needed early for most commands)
3. Key & User Management (core identity)
4. Messaging (requires token and user setup)
5. Group Encryption (requires messaging base)
6. Allow-List Controls (applies to messaging layer)
7. Utility Commands (helpers)
8. Testing & Docs (validation)
9. Cleanup (wrap-up)

---

## Phase 1: Output Format & Global Options

### 1.1 Create Shared Options Module
* [x] Create `cli/lib/options.ts`:
  * [x] Function: `withGlobalOptions<T>(handler: (opts: GlobalOptions & T) => Promise<void>)`
  * [x] Wraps command handlers to inject global options
  * [x] Handles format normalization (default: `json`)
  * [x] Provides `--no-banner` flag for scripting contexts
* [x] Export `GlobalOptions` type with all standard flags

### 1.2 Update Output Format System
* [x] Change default `--format` from `text` to `json`
* [x] Replace `compact` format with `pretty` (indented JSON) and `raw` (minimal/no formatting)
* [x] Update `cli/lib/formatters.ts`:
  * [x] Rename `compact` to `pretty`
  * [x] Add `raw` format option (minimal JSON, no indentation)
  * [x] Ensure JSON is default output
  * [x] Use RFC8785 canonicalized JSON for deterministic test snapshots
* [x] Update all commands to use `withGlobalOptions()` wrapper (extended GlobalOptions interface)
* [x] Update all commands to use new format options (json|pretty|raw)

### 1.3 Standardize Global Options
* [x] Align global options with `cli.md`:
  * [x] `--format <json|pretty|raw>` (default: `json`)
  * [x] `--token <path>` (session token file, default: `.merits/session.json`)
  * [x] `--no-banner` (suppress welcome/status messages for scripting)
  * [x] Keep `--verbose`, `--config`, `--convex-url`, `--no-color`, `--debug`
* [ ] Update `cli/index.ts` to use shared options module
* [ ] Add JSON schema validation for CLI args using TypeBox (runtime validation)

---

## Phase 2: Session Token Management

### 2.1 Implement Session Token Storage
* [ ] Create `cli/lib/session.ts`:
  * [ ] Function: `loadSessionToken(path?: string): string | null`
  * [ ] Function: `saveSessionToken(token: string, path?: string): void`
  * [ ] Default path: `.merits/session.json`
  * [ ] Stores: `{ token: string, expiresAt: number, aid: string }`
  * [ ] Set file permissions to `0600` (secure default)
  * [ ] Support `MERITS_TOKEN` environment variable fallback (for scripting)
* [ ] Create `.merits/` directory with proper permissions if missing

### 2.2 Implement Token Refresh
* [ ] In `cli/lib/session.ts`:
  * [ ] Function: `refreshSessionTokenIfNeeded(token: string, client: MeritsClient): Promise<string>`
  * [ ] Checks token expiration
  * [ ] Refreshes via backend if needed
  * [ ] Updates stored token

### 2.3 Implement `whoami` Command
* [ ] Create `cli/commands/whoami.ts`:
  * [ ] Args: `--token <path>`
  * [ ] Reads session token (from file or `MERITS_TOKEN` env)
  * [ ] Outputs JSON: `{ aid: string, expiresAt: number, roles?: string[] }`
  * [ ] Shows current AID, token expiry, and resolved roles/permissions
* [ ] Wire `whoami` in `cli/index.ts`

### 2.4 Update Commands to Use Session Tokens
* [ ] Update all commands that need auth:
  * [ ] `send`: Use `--token` or load from default path/env
  * [ ] `unread`: Use `--token` or load from default path/env
  * [ ] `list-unread`: Use `--token` or load from default path/env
  * [ ] `mark-as-read`: Use `--token` or load from default path/env
  * [ ] `create-group`: Use `--token` or load from default path/env
  * [ ] `leave`: Use `--token` or load from default path/env
  * [ ] `allow-list`: Use `--token` or load from default path/env
  * [ ] `rotate-key`: Use `--token` or load from default path/env
* [ ] Remove `--from` option (replaced by token-based auth)

---

## Phase 3: Key & User Management Commands

### 3.1 Create Crypto Constants Module
* [ ] Create `cli/lib/crypto-constants.ts`:
  * [ ] Export: `CRYPTO_DEFAULTS` (AES-256-GCM, HKDF-SHA256, etc.)
  * [ ] Export: `KEY_FORMATS` (Ed25519, X25519, CESR)
  * [ ] Document all cryptographic primitives explicitly
  * [ ] Reuse across all crypto commands

### 3.2 Implement `gen-key` Command
* [ ] Create `cli/commands/gen-key.ts`:
  * [ ] Generate Ed25519 key pair
  * [ ] Output JSON: `{ privateKey, publicKey }` (RFC8785 canonicalized)
  * [ ] Support `--seed` option for deterministic generation (testing)
  * [ ] Use canonicalized JSON output for golden snapshot tests
* [ ] Remove old `gen-user` command (no alias)
* [ ] Wire `gen-key` in `cli/index.ts`

### 3.3 Implement Local Key Registry
* [ ] Create `cli/lib/key-registry.ts`:
  * [ ] Function: `storePublicKey(aid: string, publicKey: string): void`
  * [ ] Function: `getPublicKey(aid: string): string | null`
  * [ ] Stores keys in `~/.merits/keys/<aid>.json`
  * [ ] Simplifies CLI UX in multi-user dev tests
* [ ] Integrate key registry into user management commands

### 3.4 Implement `create-user` Command
* [ ] Create `cli/commands/create-user.ts`:
  * [ ] Args: `--id <aid>`, `--public-key <key>` (or from stdin/file)
  * [ ] Calls Convex `auth.issueChallenge` with purpose `registerUser`
  * [ ] Outputs challenge JSON to stdout (RFC8785 canonicalized)
  * [ ] Store public key in local key registry
  * [ ] Remove old `create` command (no alias)
* [ ] Wire `create-user` in `cli/index.ts`

### 3.5 Implement `sign` Command
* [ ] Create `cli/commands/sign.ts`:
  * [ ] Args: `--file <challenge.json>`, `--keys <keys.json>`
  * [ ] Reads challenge from file
  * [ ] Signs challenge payload with private key from keys file
  * [ ] Outputs signed challenge response JSON to stdout (RFC8785 canonicalized)
* [ ] Wire `sign` in `cli/index.ts`

### 3.6 Implement `confirm-challenge` Command
* [ ] Create `cli/commands/confirm-challenge.ts`:
  * [ ] Args: `--file <challenge-response.json>`
  * [ ] Calls Convex `auth.proveChallenge` then `auth.registerUser`
  * [ ] On success, obtains session token
  * [ ] Stores session token to `.merits/session.json` (or `--token` path) with `0600` permissions
  * [ ] Outputs session token JSON
* [ ] Remove old `sign-challenge` command (no alias)
* [ ] Wire `confirm-challenge` in `cli/index.ts`

### 3.7 Implement `sign-in` Command
* [ ] Create `cli/commands/sign-in.ts`:
  * [ ] Args: `--id <aid>`
  * [ ] Retrieves registered public key for ID from backend (or local registry)
  * [ ] Issues challenge (similar to `create-user` but for existing user)
  * [ ] Outputs challenge JSON
  * [ ] Use with `sign` → `confirm-challenge` flow
* [ ] Wire `sign-in` in `cli/index.ts`

### 3.8 Implement `rotate-key` Command
* [ ] Create `cli/commands/rotate-key.ts`:
  * [ ] Args: `--token <path>`, `--public-key <new-key>` or `--keys-file <file>`
  * [ ] Uses session token for authentication
  * [ ] Requests key rotation challenge
  * [ ] Outputs challenge JSON (requires signing with new key)
  * [ ] After `sign` + `confirm-challenge`, updates key state
* [ ] Wire `rotate-key` in `cli/index.ts`

### 3.9 Implement `test-challenge` Command (Test Harness)
* [ ] Create `cli/commands/test-challenge.ts`:
  * [ ] Args: `--file <challenge.json>`, `--keys <keys.json>`
  * [ ] Simulates challenge-response locally (for developers)
  * [ ] Validates challenge structure without backend
  * [ ] Useful for testing and debugging
* [ ] Wire `test-challenge` in `cli/index.ts` (mark as dev-only)

### 3.10 Remove Old Identity Commands
* [ ] Remove `identity new` → replaced by `gen-key` + `create-user`
* [ ] Remove `identity list` → not in spec (consider deprecation notice)
* [ ] Remove `identity show` → not in spec
* [ ] Remove `identity register` → replaced by `create-user` flow
* [ ] Remove `identity set-default` → replaced by token-based auth
* [ ] Remove `identity export/import` → keep for backup, move to utility or remove
* [ ] Remove `identity delete` → keep for cleanup, move to utility or remove
* [ ] Update `cli/index.ts` to remove identity command group

---

## Phase 4: Messaging Commands

### 4.1 Update `send` Command
* [ ] Update `cli/commands/send.ts`:
  * [ ] Change args: `send <to>` → `send --to <recipient>`
  * [ ] Add `--type <text|encrypted>`
  * [ ] Add `--message <text>` or read from stdin (`--stdin` flag)
  * [ ] Add `--message-data <file>` for pre-encrypted data
  * [ ] Add `--encrypted` flag for automatic encryption
  * [ ] Add `--dry-run` flag to print message payload before sending (debugging)
  * [ ] Use `--token` instead of `--from` (session token)
  * [ ] Support group IDs as recipients
* [ ] Wire updated `send` in `cli/index.ts`

### 4.2 Implement `list-unread` Command
* [ ] Create `cli/commands/list-unread.ts`:
  * [ ] Args: `--token <path>`, `--from <sender-aids>` (comma-separated filter)
  * [ ] Queries backend for unread message counts per sender/group
  * [ ] Outputs JSON: `{ "bob": 4, "joe": 2, "<group-id>": 1 }`
  * [ ] Supports `--format pretty|raw`
* [ ] Wire `list-unread` in `cli/index.ts`

### 4.3 Implement `unread` Command (replaces `receive`)
* [ ] Create `cli/commands/unread.ts`:
  * [ ] Args: `--token <path>`, `--from <sender>` (optional filter), `--watch` (stream mode), `--since <timestamp>`
  * [ ] Retrieves unread messages
  * [ ] `--since`: Replay messages after downtime (useful for devs)
  * [ ] Supports `--watch` for real-time streaming (uses session tokens)
  * [ ] Implement minimal retry mechanism for `--watch` mode (transient network drops)
  * [ ] Support `--stdin` for piping message input (useful for scripts/bots)
  * [ ] Outputs messages in specified format
  * [ ] Remove old `receive` command (no alias)
  * [ ] Remove old `watch` command (replaced by `unread --watch`)
* [ ] Wire `unread` in `cli/index.ts`

### 4.4 Implement `mark-as-read` Command (replaces `ack`)
* [ ] Create `cli/commands/mark-as-read.ts`:
  * [ ] Args: `--token <path>`, `--ids <id1,id2,...>` or `--ids-data <file.json>`
  * [ ] Marks messages as read (acknowledges them)
  * [ ] Messages are deleted server-side after acknowledgment
  * [ ] Remove old `ack` command (no alias)
* [ ] Wire `mark-as-read` in `cli/index.ts`

### 4.5 Implement `extract-ids` Utility
* [ ] Create `cli/commands/extract-ids.ts`:
  * [ ] Args: `--file <messages.json>`
  * [ ] Reads message list from file (e.g., from `unread` output)
  * [ ] Extracts message IDs into JSON array
  * [ ] Outputs to stdout (for piping to `mark-as-read --ids-data`)
* [ ] Wire `extract-ids` in `cli/index.ts`

---

## Phase 5: Group Encryption Mechanism

### 5.1 Implement X25519 Key Conversion
* [ ] Create `cli/lib/crypto-group.ts`:
  * [ ] Import from `cli/lib/crypto-constants.ts`
  * [ ] Function: `ed25519ToX25519(ed25519PrivateKey, ed25519PublicKey)`
  * [ ] Converts Ed25519 keys to X25519 for Diffie-Hellman
  * [ ] Uses @noble/ed25519 and @noble/curve25519
  * [ ] Document cryptographic primitives explicitly in code comments

### 5.2 Implement Shared Secret Derivation
* [ ] In `cli/lib/crypto-group.ts`:
  * [ ] Function: `deriveSharedSecret(ourX25519PrivateKey, theirX25519PublicKey)`
  * [ ] Performs X25519 key exchange
  * [ ] Returns shared secret bytes
  * [ ] Use HKDF-SHA256 from constants

### 5.3 Implement Group Key Derivation
* [ ] In `cli/lib/crypto-group.ts`:
  * [ ] Function: `deriveGroupKey(sharedSecrets: Uint8Array[])`
  * [ ] Uses HKDF-SHA256 (from constants) to combine multiple shared secrets
  * [ ] Returns symmetric group key
  * [ ] Document KDF choice and rationale

### 5.4 Implement Group Encryption
* [ ] In `cli/lib/crypto-group.ts`:
  * [ ] Function: `encryptForGroup(message: string, memberPublicKeys: string[], ourPrivateKey: Uint8Array)`
  * [ ] Generates random group key
  * [ ] Encrypts message with group key (AES-256-GCM from constants)
  * [ ] Includes nonce and AAD fields in payload for forward compatibility
  * [ ] For each member:
    * [ ] Converts their Ed25519 public key to X25519
    * [ ] Derives shared secret
    * [ ] Encrypts group key with shared secret (AES-256-GCM)
  * [ ] Returns encrypted group message structure
  * [ ] **Critical**: Store derived group keys only in-memory; never persist even temporarily

### 5.5 Implement Group Decryption
* [ ] In `cli/lib/crypto-group.ts`:
  * [ ] Function: `decryptGroupMessage(encryptedMessage: GroupMessage, ourPrivateKey: Uint8Array, senderPublicKey: string)`
  * [ ] Finds our encrypted group key in message
  * [ ] Derives shared secret with sender
  * [ ] Decrypts group key
  * [ ] Decrypts message content with group key (AES-256-GCM)
  * [ ] Returns plaintext
  * [ ] Handle nonce and AAD fields from payload

### 5.6 Integrate Group Encryption into `send`
* [ ] Update `send` command:
  * [ ] Detect when `--to` is a group ID (vs user AID)
  * [ ] If group message:
    * [ ] Fetch group members (via backend query)
    * [ ] Use `encryptForGroup` to encrypt message
    * [ ] Send encrypted group message
  * [ ] Update message handling to support group encryption format
  * [ ] In `--dry-run` mode, show encrypted payload structure

### 5.7 Integrate Group Decryption into `unread`
* [ ] Update `unread` command:
  * [ ] Detect group messages
  * [ ] Use `decryptGroupMessage` to decrypt when possible
  * [ ] Handle decryption errors gracefully (show encrypted indicator)
  * [ ] Log cryptographic primitives used (debug mode)

---

## Phase 6: Controls (Allow-List)

### 6.1 Implement Allow-List Backend Tables
* [ ] Add to `convex/schema.ts`:
  * [ ] `allowLists` table: `{ userAID: string, allowedAIDs: string[], deniedAIDs: string[], updatedAt: number }`
  * [ ] Index: `by_user` on `userAID`

### 6.2 Implement Allow-List Convex Mutations
* [ ] Create `convex/allowlist.ts`:
  * [ ] `updateAllowList` mutation:
    * [ ] Args: `{ userAID, add?: string[], remove?: string[], auth }`
    * [ ] Updates allow/deny lists for user
    * [ ] Requires authentication
  * [ ] `updateDenyList` mutation:
    * [ ] Args: `{ userAID, add?: string[], remove?: string[], auth }`
    * [ ] Updates deny list separately
  * [ ] `getAllowList` query:
    * [ ] Args: `{ userAID }`
    * [ ] Returns current allow/deny lists

### 6.3 Implement `allow-list` CLI Command
* [ ] Create `cli/commands/allow-list.ts`:
  * [ ] Args: `--add <aid1,aid2,...>`, `--remove <aid1,aid2,...>`, `--list`, `--reset`, `--token <path>`
  * [ ] `--list`: Outputs current allow/deny lists
  * [ ] `--add/--remove`: Updates allow list
  * [ ] `--reset`: Clears allow list (quick clearing)
  * [ ] Outputs updated lists as JSON
* [ ] Wire `allow-list` in `cli/index.ts`

### 6.4 Implement `deny-list` CLI Command
* [ ] Create `cli/commands/deny-list.ts`:
  * [ ] Args: `--add <aid1,aid2,...>`, `--remove <aid1,aid2,...>`, `--list`, `--reset`, `--token <path>`
  * [ ] `--list`: Outputs current deny list
  * [ ] `--add/--remove`: Updates deny list separately (clearer than multiplexing)
  * [ ] `--reset`: Clears deny list
  * [ ] Outputs updated list as JSON
* [ ] Wire `deny-list` in `cli/index.ts`

### 6.5 Integrate Allow-List into Message Routing
* [ ] Update `convex/messages.ts`:
  * [ ] In `send` mutation:
    * [ ] Check recipient's allow-list before accepting message
    * [ ] If sender in deny-list → reject with error code `ERR_DENIED`
    * [ ] If allow-list exists and sender not in it → reject with error code `ERR_NOT_ALLOWED`
    * [ ] If allow-list empty → allow all (default)
  * [ ] Return explicit error codes for CLI UX clarity
* [ ] Update `convex/groups.ts`:
  * [ ] Similar check for group messages (optional, depends on group policy)

---

## Phase 7: Utility Commands

### 7.1 Implement `key-for` Command
* [ ] Create `cli/commands/key-for.ts`:
  * [ ] Args: `--user <aid>`, `--token <path>`
  * [ ] Queries backend for user's public key
  * [ ] Outputs JSON: `{ aid: string, publicKey: string, ksn: number }`
  * [ ] Optionally stores in local key registry
* [ ] Wire `key-for` in `cli/index.ts`

### 7.2 Implement `encrypt` Command
* [ ] Create `cli/commands/encrypt.ts`:
  * [ ] Args: `--public-key-file <file.json>`, `--message <text>` or `--stdin` (for pipes)
  * [ ] Reads recipient's public key from file (from `key-for` output)
  * [ ] Encrypts message using X25519 key exchange + AES-256-GCM
  * [ ] Outputs encrypted payload JSON to stdout
* [ ] Wire `encrypt` in `cli/index.ts`

### 7.3 Implement `decrypt` Command
* [ ] Create `cli/commands/decrypt.ts`:
  * [ ] Args: `--keys-file <file.json>`, `--file <encrypted.json>` or `--stdin`
  * [ ] Decrypts message using private key from keys file
  * [ ] Useful for parity and manual decryption testing
  * [ ] Outputs plaintext to stdout
* [ ] Wire `decrypt` in `cli/index.ts`

### 7.4 Implement `verify-signature` Command
* [ ] Create `cli/commands/verify-signature.ts`:
  * [ ] Args: `--file <signed-message.json>`, `--public-key-file <file.json>`
  * [ ] Verifies message signatures
  * [ ] Assists testing multi-party ceremonies
  * [ ] Outputs verification result JSON
* [ ] Wire `verify-signature` in `cli/index.ts`

### 7.5 Clean Up Old Commands
* [ ] Remove `init` command → not in spec (or keep as convenience)
* [ ] Review RBAC commands (`roles`, `permissions`, `users`) → move to admin namespace or remove if not in spec

---

## Phase 8: Testing & Documentation

### 8.1 Add Golden Snapshot Tests
* [ ] Create `tests/cli/golden/` directory
* [ ] Implement CLI "golden snapshot" tests (expected stdout JSON)
* [ ] Use RFC8785 canonicalized JSON for deterministic comparisons
* [ ] Test all commands produce expected output format
* [ ] Include test cases for:
  * [ ] Session token expiry cases (mock expiry scenarios)
  * [ ] Invalid flags (confirm correct error messages and exit codes)
  * [ ] Error conditions (explicit error codes)

### 8.2 Update Integration Tests
* [ ] Update integration tests to use new command names
* [ ] Test session token flow: `create-user` → `sign` → `confirm-challenge`
* [ ] Test `sign-in` flow
* [ ] Test `rotate-key` flow
* [ ] Test group encryption/decryption
* [ ] Test allow-list and deny-list functionality
* [ ] Add deterministic end-to-end test:
  * [ ] `create-user` → `sign-in` → `send` → `unread` → `mark-as-read`
  * [ ] Validates full workflow deterministically

### 8.3 Auto-Generate CLI Docs
* [ ] Create `cli/lib/doc-generator.ts`:
  * [ ] Extracts command metadata (help text, args, examples)
  * [ ] Generates `cli.md` from command definitions
  * [ ] Ensures `cli.md` and `--help` output remain in sync
* [ ] Add CI check to validate docs match implementation

### 8.4 Update Documentation
* [ ] Update `cli/README.md` to match `cli.md` spec
* [ ] Add examples for each command
* [ ] Document session token storage and refresh
* [ ] Document group encryption mechanism (including crypto primitives)
* [ ] Document allow-list and deny-list controls
* [ ] Document exit codes and error handling

---

## Phase 9: Migration & Cleanup

### 9.1 Remove Deprecated Code
* [ ] Delete old command files:
  * [ ] `cli/commands/gen-user.ts`
  * [ ] `cli/commands/create.ts`
  * [ ] `cli/commands/sign-challenge.ts`
  * [ ] `cli/commands/receive.ts` (replaced by `unread`)
  * [ ] `cli/commands/ack.ts` (replaced by `mark-as-read`)
  * [ ] `cli/commands/watch.ts` (replaced by `unread --watch`)
* [ ] Clean up unused imports and types
* [ ] Run `ts-prune` to confirm no dead imports
* [ ] Run `depcheck` to verify dependency cleanliness

### 9.2 Final Validation
* [ ] Run full test suite
* [ ] Verify all commands match `cli.md` specification
* [ ] Check output formats are correct (json default, pretty/raw options)
* [ ] Ensure no old command aliases remain
* [ ] Validate exit codes (0 on success, non-zero with meaningful stderr)
* [ ] Verify file permissions on stored tokens/keys (0600)
* [ ] Confirm all key derivations are reproducible (test vectors)

---

## Acceptance Criteria

### Command Implementation
* [ ] All commands from `cli.md` are implemented with exact names/flags
* [ ] Default output format is `json`
* [ ] `pretty` and `raw` format options work correctly
* [ ] RFC8785 canonicalized JSON for deterministic test snapshots

### Session Token Management
* [ ] Session tokens are stored in `.merits/session.json` by default
* [ ] `MERITS_TOKEN` environment variable fallback works
* [ ] File permissions are `0600` (secure default)
* [ ] Token refresh works automatically

### Group Encryption
* [ ] Group encryption with X25519 key derivation works end-to-end
* [ ] Derived group keys stored only in-memory (never persisted)
* [ ] Nonce and AAD fields included in payload for forward compatibility
* [ ] Cryptographic primitives documented (AES-256-GCM, HKDF-SHA256)
* [ ] All key derivations reproducible (test vectors)

### Controls
* [ ] Allow-list controls are functional
* [ ] Deny-list controls are functional (separate command)
* [ ] `--reset` flag clears lists correctly
* [ ] Error codes (`ERR_DENIED`, `ERR_NOT_ALLOWED`) returned correctly

### Security & UX
* [ ] All tokens/keys stored locally with restricted file permissions (0600)
* [ ] Each command returns exit code 0 on success, non-zero with meaningful stderr
* [ ] `cli.md` and `--help` output remain in sync (auto-generated from same source)
* [ ] No old command names remain (no aliases)

### Testing & Documentation
* [ ] All tests pass (including golden snapshots)
* [ ] Documentation matches implementation
* [ ] CLI golden snapshot tests validate output deterministically
* [ ] End-to-end test simulates full workflow

---

## Notes

- **Session tokens**: Short-lived (60s max per current implementation), stored securely with `0600` permissions
- **Group encryption**: Uses Ed25519 → X25519 conversion for key exchange, AES-256-GCM for encryption, HKDF-SHA256 for key derivation
- **Allow-list**: User-controlled (default: allow all), separate commands for allow-list and deny-list
- **Key rotation**: Requires signing with new key to prove control
- **Crypto constants**: Centralized in `cli/lib/crypto-constants.ts` for maintainability
- **Golden snapshots**: Use RFC8785 canonicalized JSON for deterministic test comparisons
- **Exit codes**: 0 on success, non-zero on error (with meaningful stderr messages)
- **File permissions**: All sensitive files (tokens, keys) use `0600` permissions
- **Error codes**: Explicit codes (`ERR_DENIED`, `ERR_NOT_ALLOWED`) for better CLI UX