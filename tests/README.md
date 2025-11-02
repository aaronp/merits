# Merits Testing Guide

Comprehensive guide to the Merits test infrastructure, patterns, and best practices.

## Table of Contents

- [Overview](#overview)
- [Test Infrastructure](#test-infrastructure)
- [Quick Start](#quick-start)
- [Writing Tests](#writing-tests)
- [Test Helpers](#test-helpers)
- [Running Tests](#running-tests)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

---

## Overview

The Merits test suite uses **in-process CLI testing** for fast, debuggable end-to-end tests. Tests run 10-100x faster than traditional subprocess-based testing and allow setting breakpoints in command code.

### Test Categories

- **Unit Tests**: Test individual functions/modules (no backend required)
- **E2E Tests**: Test complete CLI workflows (requires CONVEX_URL)
- **Integration Tests**: Test backend integration (requires CONVEX_URL + BOOTSTRAP_KEY)
- **Performance Tests**: Benchmark and performance validation

### Key Statistics

- **90+ test cases** covering all major features
- **3,100+ lines** of test code
- **96x faster** than subprocess testing
- **100% test isolation** with dedicated workspaces

---

## Test Infrastructure

### In-Process CLI Runner

Location: `tests/cli/helpers/exec.ts`

The in-process runner executes CLI commands without spawning subprocesses:

```typescript
import { runCliInProcess, assertSuccess } from "../helpers/exec";

const result = await runCliInProcess(["gen-key", "--seed", "test123"], {
  env: { MERITS_VAULT_QUIET: "1" }
});

assertSuccess(result);
expect(result.json.aid).toBeDefined();
```

**Benefits:**
- 10-100x faster execution
- Can set breakpoints in command code
- Direct access to result objects
- No file I/O overhead
- Captures console.log/error output

### Test Workspaces

Location: `tests/cli/helpers/workspace.ts`

Isolated temporary directories for each test scenario:

```typescript
import { mkScenario, mkMultiUserScenario } from "../helpers/workspace";

// Single user scenario
const scenario = mkScenario("my-test");
// Use: scenario.root, scenario.dataDir, scenario.sessionPath
scenario.cleanup(); // Clean up when done

// Multi-user scenario
const { users, cleanup } = mkMultiUserScenario("multi-test", ["alice", "bob"]);
// Use: users.alice.root, users.bob.dataDir, etc.
cleanup(); // Clean up all users
```

### Admin Bootstrap Helper

Location: `tests/helpers/admin-bootstrap.ts`

Persistent admin user for tests (uses `.admin-seed` file):

```typescript
import { ensureAdminInitialised } from "../../helpers/admin-bootstrap";

const admin = await ensureAdminInitialised(CONVEX_URL);
// Use: admin.aid, admin.privateKey, admin.publicKey, etc.
// Same admin across all test runs (deterministic)
```

---

## Quick Start

### 1. Run All Tests

```bash
# Set environment variables
export CONVEX_URL="https://your-deployment.convex.cloud"
export BOOTSTRAP_KEY="dev-only-secret"

# Run all tests
bun test

# Run specific category
bun test tests/cli/e2e/
bun test tests/unit/
```

### 2. Run Specific Test File

```bash
bun test tests/cli/e2e/incept-users.test.ts
bun test tests/cli/e2e/group-messaging.test.ts
```

### 3. Run Without Backend (Unit Tests Only)

```bash
# No CONVEX_URL needed
bun test tests/cli/e2e/gen-key-inprocess.test.ts
```

### 4. Run Performance Benchmark

```bash
bun test tests/cli/performance/subprocess-vs-inprocess.test.ts
```

---

## Writing Tests

### Basic Test Structure

```typescript
import { describe, it, expect, beforeAll } from "bun:test";
import { runCliInProcess, assertSuccess } from "../helpers/exec";
import { mkScenario } from "../helpers/workspace";

// Only run if CONVEX_URL is set
const CONVEX_URL = process.env.CONVEX_URL;
const shouldRun = CONVEX_URL ? describe : describe.skip;

shouldRun("My Test Suite", () => {
  let scenario: ReturnType<typeof mkScenario>;

  beforeAll(() => {
    scenario = mkScenario("my-test");
  });

  it("should do something", async () => {
    const result = await runCliInProcess(
      ["command", "arg1", "arg2"],
      {
        cwd: scenario.root,
        env: {
          MERITS_VAULT_QUIET: "1",
          CONVEX_URL: CONVEX_URL!,
        },
      }
    );

    assertSuccess(result);
    expect(result.json.someField).toBeDefined();
  });
});
```

### Multi-User Test Pattern

```typescript
import { mkMultiUserScenario } from "../helpers/workspace";

const scenario = mkMultiUserScenario("test-name", ["alice", "bob"]);

// Alice's action
const aliceResult = await runCliInProcess(
  ["send", bobAid, "--message", "Hello"],
  {
    cwd: scenario.users.alice.root,
    env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
  }
);

// Bob's action
const bobResult = await runCliInProcess(
  ["unread"],
  {
    cwd: scenario.users.bob.root,
    env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
  }
);

// Clean up
scenario.cleanup();
```

### Admin Operations Pattern

```typescript
import { ensureAdminInitialised } from "../../helpers/admin-bootstrap";

const admin = await ensureAdminInitialised(CONVEX_URL!);

// Grant role
await runCliInProcess(
  [
    "users",
    "grant-role",
    userAid,
    "user",
    "--adminAID",
    admin.aid,
    "--actionSAID",
    "test-action-said",
  ],
  { env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! } }
);
```

---

## Test Helpers

### runCliInProcess()

Execute CLI commands in-process:

```typescript
const result = await runCliInProcess(
  ["command", "arg1"],  // Command arguments
  {
    cwd: "/path/to/workspace",  // Optional: working directory
    env: { KEY: "value" },      // Optional: environment variables
  }
);

// Result structure
result.code    // Exit code (0 = success)
result.stdout  // Standard output
result.stderr  // Standard error
result.json    // Parsed JSON output (if valid)
result.error   // Error object (if thrown)
```

### Assertion Helpers

```typescript
import { assertSuccess, assertFailure } from "../helpers/exec";

// Assert command succeeded (exit code 0)
assertSuccess(result);

// Assert command failed (exit code non-zero)
assertFailure(result);
```

### File Helpers

```typescript
import { writeJSON, readJSON } from "../helpers/workspace";

// Write JSON to file
writeJSON("/path/to/file.json", { key: "value" });

// Read JSON from file
const data = readJSON("/path/to/file.json");
```

---

## Running Tests

### Development Workflow

```bash
# 1. Set up environment
export CONVEX_URL="https://your-deployment.convex.cloud"
export BOOTSTRAP_KEY="dev-only-secret"

# 2. Run tests during development
bun test --watch tests/cli/e2e/my-test.test.ts

# 3. Run all tests before commit
bun test
```

### CI/CD Integration

```yaml
# .github/workflows/test.yml
name: Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: oven-sh/setup-bun@v1

      - name: Install dependencies
        run: bun install

      - name: Run unit tests (no backend)
        run: bun test tests/cli/e2e/gen-key-inprocess.test.ts

      - name: Deploy test backend
        run: bunx convex deploy
        env:
          CONVEX_DEPLOY_KEY: ${{ secrets.CONVEX_DEPLOY_KEY }}

      - name: Run E2E tests
        run: bun test tests/cli/e2e/
        env:
          CONVEX_URL: ${{ secrets.CONVEX_TEST_URL }}
          BOOTSTRAP_KEY: "dev-only-secret"
```

---

## Best Practices

### 1. Test Isolation

✅ **DO:**
- Use `mkScenario()` or `mkMultiUserScenario()` for isolated workspaces
- Clean up after tests with `scenario.cleanup()`
- Use deterministic seeds for reproducible tests

❌ **DON'T:**
- Share workspaces between tests
- Use hardcoded file paths
- Rely on test execution order

### 2. Conditional Execution

✅ **DO:**
```typescript
const CONVEX_URL = process.env.CONVEX_URL;
const shouldRun = CONVEX_URL ? describe : describe.skip;

shouldRun("E2E Tests", () => {
  // Tests only run if CONVEX_URL is set
});
```

❌ **DON'T:**
```typescript
describe("E2E Tests", () => {
  if (!process.env.CONVEX_URL) return; // Hard to debug
});
```

### 3. Async/Await

✅ **DO:**
```typescript
it("should create user", async () => {
  const result = await runCliInProcess(["incept", "--seed", "test"]);
  assertSuccess(result);
});
```

❌ **DON'T:**
```typescript
it("should create user", () => {
  runCliInProcess(["incept"]).then(result => {
    // Don't mix promises and callbacks
  });
});
```

### 4. Error Messages

✅ **DO:**
```typescript
expect(result.json.aid).toBeDefined();
expect(result.json.aid).toMatch(/^[DE]/);
expect(result.json.session.active).toBe(true);
```

❌ **DON'T:**
```typescript
expect(result.json.aid).toBeTruthy(); // Too vague
expect(result.json).toBeDefined();     // Not specific enough
```

### 5. Timeouts

✅ **DO:**
```typescript
it("should complete operation", async () => {
  // Long-running test
}, 30000); // 30 second timeout
```

❌ **DON'T:**
```typescript
it("should complete operation", async () => {
  // Might timeout with default (5s)
});
```

### 6. Message Propagation

✅ **DO:**
```typescript
await runCliInProcess(["send", recipient, "--message", "test"]);

// Wait for propagation
await new Promise((resolve) => setTimeout(resolve, 1000));

const result = await runCliInProcess(["unread"]);
```

❌ **DON'T:**
```typescript
await runCliInProcess(["send", recipient, "--message", "test"]);
const result = await runCliInProcess(["unread"]); // May miss message
```

---

## Troubleshooting

### Tests Skip Unexpectedly

**Problem:** Tests show as "skipped" instead of running

**Solution:** Check that environment variables are set:
```bash
echo $CONVEX_URL        # Should be set
echo $BOOTSTRAP_KEY     # Should be set for bootstrap tests
```

### "Server Error" or Connection Failures

**Problem:** Tests fail with "Server Error" or connection issues

**Solution:**
1. Verify CONVEX_URL is correct and reachable
2. Ensure backend is deployed with latest code
3. Check BOOTSTRAP_KEY matches backend configuration

### Flaky Tests (Intermittent Failures)

**Problem:** Tests pass sometimes, fail sometimes

**Common Causes:**
1. **Message propagation**: Add delays after sending messages
2. **Race conditions**: Ensure proper sequencing with await
3. **Shared state**: Verify tests are properly isolated

**Solution:**
```typescript
// Add propagation delay
await new Promise((resolve) => setTimeout(resolve, 1000));

// Ensure proper sequencing
await Promise.all([operation1(), operation2()]); // Parallel
await operation1(); await operation2();          // Sequential
```

### "Session Not Found" Errors

**Problem:** Tests fail with session-related errors

**Solution:**
1. Verify `incept` or `sign-in` succeeded before operations
2. Check session file exists in scenario workspace
3. Ensure `cwd` points to correct user's workspace

### Performance Issues

**Problem:** Tests are slow

**Solution:**
1. Verify using `runCliInProcess()` (not subprocess)
2. Run performance benchmark to compare
3. Consider reducing test scope or parallelizing

### Debug Mode

Enable detailed output:

```bash
# CLI debug mode
export MERITS_DEBUG=1
bun test tests/cli/e2e/my-test.test.ts

# Show full error stacks
bun test --bail tests/cli/e2e/my-test.test.ts
```

---

## Test File Organization

```
tests/
├── README.md                    ← This file
├── cli/
│   ├── helpers/
│   │   ├── exec.ts             ← In-process CLI runner
│   │   └── workspace.ts        ← Test workspaces
│   ├── e2e/                    ← End-to-end CLI tests
│   │   ├── gen-key-inprocess.test.ts
│   │   ├── incept-users.test.ts
│   │   ├── bootstrap.test.ts
│   │   ├── role-upgrade.test.ts
│   │   ├── group-messaging.test.ts
│   │   ├── default-access.test.ts
│   │   ├── allow-deny-lists.test.ts
│   │   ├── unread-pipeline.test.ts
│   │   ├── direct-messaging.test.ts
│   │   ├── sign-in-flow.test.ts
│   │   └── encryption-utilities.test.ts
│   ├── performance/
│   │   └── subprocess-vs-inprocess.test.ts
│   └── unit/                   ← Unit tests
├── helpers/
│   ├── admin-bootstrap.ts      ← Admin helper
│   └── admin-bootstrap.example.test.ts
└── integration/                ← Integration tests
```

---

## Example Test Files

### Example 1: Simple Unit Test

```typescript
// tests/cli/e2e/simple-example.test.ts
import { describe, it, expect } from "bun:test";
import { runCliInProcess, assertSuccess } from "../helpers/exec";

describe("Simple Example", () => {
  it("generates keys with seed", async () => {
    const result = await runCliInProcess(
      ["gen-key", "--seed", "test123"],
      { env: { MERITS_VAULT_QUIET: "1" } }
    );

    assertSuccess(result);
    expect(result.json.aid).toBeString();
    expect(result.json.aid).toStartWith("D");
  });
});
```

### Example 2: E2E Test with Backend

```typescript
// tests/cli/e2e/full-example.test.ts
import { describe, it, expect, beforeAll } from "bun:test";
import { runCliInProcess, assertSuccess } from "../helpers/exec";
import { mkMultiUserScenario } from "../helpers/workspace";
import { ensureAdminInitialised } from "../../helpers/admin-bootstrap";

const CONVEX_URL = process.env.CONVEX_URL;
const BOOTSTRAP_KEY = process.env.BOOTSTRAP_KEY;
const shouldRun = CONVEX_URL && BOOTSTRAP_KEY;

(shouldRun ? describe : describe.skip)("Full Example", () => {
  let scenario: ReturnType<typeof mkMultiUserScenario>;
  let admin: any;
  let aliceAid: string;

  beforeAll(async () => {
    admin = await ensureAdminInitialised(CONVEX_URL!);
    scenario = mkMultiUserScenario("example", ["alice", "bob"]);

    // Incept Alice
    const result = await runCliInProcess(
      ["incept", "--seed", "alice-example"],
      {
        cwd: scenario.users.alice.root,
        env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
      }
    );

    assertSuccess(result);
    aliceAid = result.json.aid;

    // Grant user role
    await runCliInProcess(
      [
        "users",
        "grant-role",
        aliceAid,
        "user",
        "--adminAID",
        admin.aid,
        "--actionSAID",
        "example-grant",
      ],
      { env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! } }
    );
  }, 60000);

  it("alice creates group", async () => {
    const result = await runCliInProcess(
      ["group", "create", "Example Group"],
      {
        cwd: scenario.users.alice.root,
        env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
      }
    );

    assertSuccess(result);
    expect(result.json.groupId).toBeDefined();
  }, 15000);
});
```

---

## Contributing

When adding new tests:

1. **Follow existing patterns** in similar test files
2. **Use descriptive test names** that explain what's being tested
3. **Add comments** for complex test logic
4. **Clean up resources** with `scenario.cleanup()`
5. **Set appropriate timeouts** for long-running tests
6. **Test edge cases** and error scenarios
7. **Update this README** if adding new patterns or helpers

---

## Performance Metrics

Current test suite performance:

- **Unit tests**: ~130ms for 8 tests (gen-key)
- **Single command**: ~4ms (in-process) vs ~382ms (subprocess)
- **Batch of 50**: ~134ms (in-process) vs ~19,252ms (subprocess)
- **Speedup**: **96-143x faster** than subprocess testing

---

## Resources

- [CLI Test Strategy](../docs/cli-test-strategy.md) - Overall testing strategy
- [Bootstrap Plan](../docs/bootstrap-plan.md) - Bootstrap and admin setup
- [Bun Test Documentation](https://bun.sh/docs/cli/test) - Bun test runner docs
- [Commander.js](https://github.com/tj/commander.js) - CLI framework used

---

**Last Updated:** 2025-01-XX
**Test Suite Version:** 2.0 (In-Process Testing)
