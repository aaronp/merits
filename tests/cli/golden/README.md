# Golden Snapshot Tests

Golden snapshot tests ensure that CLI command output remains stable across changes. They compare actual command output against stored "golden" reference files.

## Purpose

- **Catch unintended changes** to output format
- **Ensure RFC8785 canonicalization** remains consistent
- **Validate deterministic commands** produce identical output
- **Make breaking changes explicit** and reviewable

## Running Tests

### Verify Mode (Default)
```bash
bun test tests/cli/golden/
```

This compares actual output against stored snapshots and fails if they differ.

### Update Mode
```bash
GOLDEN_UPDATE=1 bun test tests/cli/golden/
```

This regenerates all golden snapshots from current command output. **Only do this after carefully reviewing the diff!**

## Snapshot Files

Snapshots are stored in `tests/cli/golden/snapshots/`:

```
tests/cli/golden/
├── README.md                           # This file
├── golden-snapshot.test.ts             # Test suite
└── snapshots/                          # Golden reference files
    ├── gen-key-seed-1.json             # Canonical JSON output
    ├── gen-key-pretty.json             # Pretty-printed JSON output
    ├── verify-signature-valid.json     # Signature verification result
    └── ...                             # More snapshots
```

## What's Tested

### 1. Deterministic Key Generation
- `gen-key --seed <value>` produces identical output for the same seed
- Different seeds produce different keys
- Output format matches RFC8785 canonicalization

### 2. Output Formats
- **json**: Canonical JSON (no whitespace, alphabetical keys)
- **pretty**: Indented JSON (2 spaces, newlines)
- **raw**: Minimal output (command-specific)

### 3. RFC8785 Canonicalization
- Keys are in alphabetical order
- No whitespace between tokens
- Consistent number formatting
- Deterministic output

### 4. Signature Verification
- Valid signatures return `{"valid":true}`
- Output format is consistent across runs

## Adding New Golden Tests

1. **Write the test** in `golden-snapshot.test.ts`:
   ```typescript
   test("new command produces deterministic output", async () => {
     const output = await runCLI(["my-command", "--seed", "test"]);
     expectMatchesGolden("my-command-test", output);
   });
   ```

2. **Generate the snapshot**:
   ```bash
   GOLDEN_UPDATE=1 bun test tests/cli/golden/
   ```

3. **Verify the snapshot** looks correct:
   ```bash
   cat tests/cli/golden/snapshots/my-command-test.json
   ```

4. **Run in verify mode** to ensure it works:
   ```bash
   bun test tests/cli/golden/
   ```

5. **Commit both** the test and snapshot files

## When to Update Snapshots

**Update snapshots when:**
- ✅ You intentionally changed output format
- ✅ You added new fields to JSON output
- ✅ You improved canonicalization implementation
- ✅ You fixed a bug in output formatting

**DO NOT update snapshots when:**
- ❌ Tests are failing and you haven't investigated why
- ❌ You're making unrelated changes
- ❌ Output changed unexpectedly and you don't know why

## Best Practices

1. **Review diffs carefully** before updating snapshots
2. **Use deterministic inputs** (seeds, fixed timestamps, etc.)
3. **Test multiple output formats** (json, pretty, raw)
4. **Keep snapshots small** - test specific behaviors, not entire workflows
5. **Document intentional changes** in commit messages

## Troubleshooting

### Snapshot Mismatch
```
=== Golden Snapshot Mismatch ===
Test: gen-key-seed-1
Snapshot: tests/cli/golden/snapshots/gen-key-seed-1.json

Expected:
{"privateKey":"abc...","publicKey":"xyz..."}

Actual:
{"privateKey":"def...","publicKey":"uvw..."}
```

**Diagnosis:**
- If keys changed: Check if key generation algorithm was modified
- If format changed: Check if JSON canonicalization was modified
- If unexpected: Investigate what caused the change

### Missing Snapshot
```
Golden snapshot missing: my-test
Run: GOLDEN_UPDATE=1 bun test tests/cli/golden/ to create it
```

**Solution:** Run the test in update mode to create the initial snapshot

### Snapshot File Issues
```
Error: ENOENT: no such file or directory
```

**Solution:** Ensure `tests/cli/golden/snapshots/` directory exists

## Examples

### Canonical JSON Output
```json
{"privateKey":"gJTzI4voHyHV3Qq5Z9_L1wOq3UaN1SQ0Fi6qdX-KTlE","publicKey":"J1KnxZ3WYClkX3rtwxUZPBstTbtdlOaW77ZDuSAzqVY"}
```

Note: No whitespace, alphabetically sorted keys

### Pretty JSON Output
```json
{
  "privateKey": "z5XsnzqujAfUnoJe1GNMNQlwjTdwsK8DzbTWnReT2Q8",
  "publicKey": "tBfGUduz3mY6V13_hRF0wJmOFOhmCIkDZuisyV8Oe4c"
}
```

Note: 2-space indentation, newlines after each field

## Related Documentation

- [RFC 8785: JSON Canonicalization Scheme (JCS)](https://www.rfc-editor.org/rfc/rfc8785)
- [CLI Specification](../../../cli/cli.md)
- [E2E Test Suite](../e2e/new-cli-spec.test.ts)
- [CLI Progress Summary](../../../docs/CLI-PROGRESS-SUMMARY.md)
