# Merits CLI Test Strategy (In‑Process, Black‑Box)

This document defines how to write fast, deterministic **end‑to‑end** tests for the Merits CLI **without spawning a subprocess**. We execute the **actual Commander program in‑process**, using the same hooks and command wiring you ship to users. Tests remain black‑box (CLI surface only).

---

## Current State & Migration Plan

### What Exists Today

**Test Structure:** `/tests/`
- ✅ `cli/unit/` - Unit tests for formatters, config, vault (fast, isolated)
- ✅ `cli/e2e/` - E2E tests with subprocess execution (~1000+ lines in new-cli-spec.test.ts)
- ✅ `cli/integration/` - Integration tests for messaging flows
- ✅ `cli/golden/` - Golden snapshot tests (gen-key, verify-signature)
- ✅ `cli/performance/` - Performance benchmarks
- ✅ `helpers/` - Convex setup, crypto utils, eventually() polling

**Current Test Pattern (Subprocess):**
```typescript
// tests/cli/e2e/new-cli-spec.test.ts (current)
const result = await $`bun cli/index.ts gen-key --seed test123`
  .env({ CONVEX_URL: "https://test.convex.cloud" })
  .text();

const parsed = JSON.parse(result.trim());
expect(parsed.publicKey).toBeDefined();
```

**Pros:**
- ✅ Works today, all tests passing
- ✅ True black-box testing
- ✅ Catches CLI startup issues

**Cons:**
- ⚠️ Slow (spawns process for each command)
- ⚠️ Hard to debug (can't inspect internal state)
- ⚠️ Verbose error messages difficult to capture
- ⚠️ Can't mock or stub internal dependencies

### Target State (In-Process)

**Planned Pattern:**
```typescript
// tests/cli/e2e/incept-users.test.ts (target)
import { runCliInProcess } from "../helpers/exec";

const result = await runCliInProcess(["gen-key", "--seed", "test123"], {
  env: { CONVEX_URL: "https://test.convex.cloud" }
});

expect(result.code).toBe(0);
expect(result.json.publicKey).toBeDefined();
```

**Benefits:**
- 🚀 10-100x faster (no process spawn overhead)
- 🐛 Easy debugging (set breakpoints in command code)
- 📊 Better error capture (stdout/stderr separate)
- 🎯 Can inspect internal state if needed
- ✅ Still exercises full CLI code path

### Migration Strategy

**Phase 1 (Week 1):** Create infrastructure without breaking existing tests
- Create `cli/build-program.ts` factory
- Create `tests/cli/helpers/exec.ts` runner
- Create `tests/cli/helpers/workspace.ts` helpers
- Proof-of-concept: Migrate 1-2 simple tests

**Phase 2 (Week 2-3):** Migrate priority scenarios
- Migrate P0 scenarios (incept, role-upgrade, group-permissions)
- Keep subprocess tests running in parallel
- Compare performance and debuggability

**Phase 3 (Week 4):** Complete migration
- Migrate remaining test files
- Remove subprocess-based tests
- Update CI/CD configuration
- Document new testing patterns

---

## Goals

- **Black‑box via CLI**: only public commands & flags.
- **In‑process**: no `child_process`; faster, easier debug, same code paths.
- **Deterministic**: seeds, isolated data dirs, canonical JSON, golden snapshots.
- **Portable**: run with Bun test runner or a bash+jq harness.

---

## Conventions

- **One temp workspace per scenario**: never touch `~/.merits`.
  - Always pass `--data-dir` and `--token` under the scenario folder.
- **Deterministic keys**: pass `--seed` to `incept`/`gen-key` in tests.
- **Canonical JSON**: use `--format json` and assert structurally (jq/Bun).
- **Golden snapshots**: snapshot only **stable** shapes (avoid timestamps unless normalized).
- **Return codes**: success = `0`; auth/validation failures = non‑zero with `Code:` and optional `Hint:` in stderr.
- **Isolation**: scenarios do **not** share directories, tokens, or groups unless explicitly required.
- **No network assumptions**: point `--convex-url` at a dedicated test instance (CI can spin this up).

---

## Tiny Refactor: Export a Factory (No Auto‑Parse on Import)

Create `cli/build-program.ts` which **builds** the Commander `program` but **does not** parse/exit. Your current CLI content moves here (unchanged, just omit the final `parseAsync`).

```ts
// cli/build-program.ts
import { Command } from "commander";
// ... all current imports (commands, hooks, etc.)

export function createMeritsProgram() {
  const program = new Command();

  program
    .name("merits")
    .description("Merits messaging CLI - KERI-authenticated secure messaging with zero-knowledge group encryption")
    .version("0.1.0");

  // ... your global options, hooks, and .command(...) registrations ...

  // IMPORTANT: do NOT call program.parseAsync() here.
  return program;
}
```

Make a thin executable wrapper that only runs when invoked from the shell:

```ts
// cli/merits.ts  (bin entrypoint with shebang)
#!/usr/bin/env bun
import { createMeritsProgram } from "./build-program";

async function main() {
  const program = createMeritsProgram();
  try {
    await program.parseAsync(process.argv, { from: "node" });
  } catch (error: any) {
    // your pretty error handler (retain existing behavior)
    process.exit(1);
  }
}

main();
```

---

## In‑Process Runner for Tests

Use Commander’s `exitOverride()` and `configureOutput()` to **capture stdout/stderr** and prevent `process.exit`. We also temporarily intercept `console.log/error` used by command handlers.

`tests/e2e/helpers/exec.ts`:

```ts
import { createMeritsProgram } from "../../../cli/build-program";
import type { Command } from "commander";

export type RunResult = {
  code: number;
  stdout: string;
  stderr: string;
  json?: unknown;
};

/**
 * Run the Merits CLI in-process, using the same Commander wiring.
 * @param args CLI args as a user would type (excluding "node merits")
 * @param opts cwd/env overrides for test isolation
 */
export async function runCliInProcess(args: string[], opts?: { cwd?: string; env?: Record<string, string> }): Promise<RunResult> {
  const prevCwd = process.cwd();
  const prevEnv = { ...process.env };
  const prevLog = console.log;
  const prevErr = console.error;

  let stdout = "";
  let stderr = "";
  let exitCode = 0;

  if (opts?.cwd) process.chdir(opts.cwd);
  if (opts?.env) Object.assign(process.env, opts.env);

  console.log = (...a: any[]) => { stdout += a.map(x => typeof x === "string" ? x : JSON.stringify(x)).join(" ") + "\\n"; };
  console.error = (...a: any[]) => { stderr += a.map(x => typeof x === "string" ? x : JSON.stringify(x)).join(" ") + "\\n"; };

  const program: Command = createMeritsProgram();

  program.exitOverride((err) => { throw err; }); // stop process.exit
  program.configureOutput({
    writeOut: (str) => { stdout += str; },
    writeErr: (str) => { stderr += str; },
    outputError: (str) => { stderr += str; },
  });

  try {
    await program.parseAsync(["node", "merits", ...args], { from: "user" });
  } catch (err: any) {
    exitCode = typeof err?.exitCode === "number" ? err.exitCode : 1;
  } finally {
    console.log = prevLog;
    console.error = prevErr;
    if (opts?.cwd) process.chdir(prevCwd);
    process.env = prevEnv;
  }

  let parsed: unknown;
  try { parsed = JSON.parse(stdout.trim()); } catch { /* non-JSON output */ }

  return { code: exitCode, stdout, stderr, json: parsed };
}
```

---

## Test Workspace Helpers

`tests/e2e/helpers/fs.ts`:

```ts
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function mkScenario(name: string) {
  const root = mkdtempSync(join(tmpdir(), \`merits-\${name}-\`));
  const token = join(root, "session.json");
  const dataDir = join(root, "data");
  mkdirSync(dataDir);
  return { root, token, dataDir };
}

export function writeJSON(path: string, obj: any) {
  writeFileSync(path, JSON.stringify(obj));
}

export function readJSON(path: string) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function snapshot(path: string, obj: any) {
  writeFileSync(path, JSON.stringify(obj));
}
```

---

## Test Workspace Layout

```
tests/
  e2e/
    helpers/
      exec.ts           # in-process CLI runner (Commander)
      fs.ts             # scenario dirs, file IO, snapshots
      said.ts           # optional – fixed SAIDs or generators
    __snapshots__/
      01_bootstrap.snap.json
      ...
    00_smoke.spec.ts
    01_bootstrap_onboarding.spec.ts
    02_incept_new_users.spec.ts
    03_onboarding_access.spec.ts
    04_group_cohort.spec.ts
    05_role_upgrade_user.spec.ts
    06_group_creation_by_user.spec.ts
    07_allow_deny_lists.spec.ts
    08_unread_mark_read.spec.ts
    09_forwarding_encrypt_decrypt.spec.ts
```

> Prefer **one scenario per file**. Keep them serial to avoid cross‑talk.

---

## Example Spec (Deterministic Inception)

`tests/e2e/02_incept_new_users.spec.ts`

```ts
import { describe, it, expect } from "bun:test";
import { mkScenario } from "./helpers/fs";
import { runCliInProcess } from "./helpers/exec";

const URL = process.env.MERITS_CONVEX_URL ?? "http://localhost:3000";

describe("02 – incept new users", () => {
  it("creates admin, alice, bob with deterministic keys", async () => {
    const S = mkScenario("incept");
    const base = ["--convex-url", URL, "--data-dir", S.dataDir, "--token", S.token, "--no-banner"];

    // Admin
    let r = await runCliInProcess([...base, "incept", "--seed", "admin-seed"]);
    expect(r.code).toBe(0);
    const adminAid = (r.json as any).aid;
    expect(adminAid).toBeDefined();

    // whoami
    r = await runCliInProcess([...base, "whoami"]);
    expect(r.code).toBe(0);
    expect((r.json as any).session.active).toBeTrue();

    // Alice
    r = await runCliInProcess([...base, "incept", "--seed", "alice-seed"]);
    expect(r.code).toBe(0);

    // Bob
    r = await runCliInProcess([...base, "incept", "--seed", "bob-seed"]);
    expect(r.code).toBe(0);
  });
});
```

---

## Key Scenarios & Assertions

### 01) Bootstrap Onboarding
**Steps**
1. `incept --seed admin-seed`
2. `rbac:bootstrap-onboarding`

**Assert**
- Exit `0`
- Onboarding group exists (via `group list` or `group info` snapshot)

---

### 02) Incept New Users
**Steps**
- `incept --seed alice-seed`
- `incept --seed bob-seed`

**Assert**
- Each output has `.aid` and `.session.token`
- `ksn` = 0

---

### 03) Default Access for `anon`
**Assumption**: Fresh users (role `anon`) can only DM onboarding admins.

**Steps (Alice)**
- `send <bobAid> --message "hi"` → **fail** (AUTH_FORBIDDEN/ROLE_DENIED)
- `send <adminAid> --message "help"` → **ok**

**Assert**
- DM to Bob: non‑zero code; stderr includes `Code:`
- DM to Admin: success, messageId present
- Admin `unread` shows Alice’s DM with typ=`encrypted`

---

### 04) Cohort Group Messaging
**Steps (Admin)**
- `group create "Intro Cohort A" --from <adminAid>`
- `group add <groupId> <aliceAid> --role member`
- `group add <groupId> <bobAid> --role member`

**Steps**
- Alice: `send <groupId> --message "hello cohort"`
- Bob: `unread`

**Assert**
- `group info` lists both members
- Bob decrypts typ=`group-encrypted` and content matches

---

### 05) Role Upgrade `anon` → `user` via SAID
**Pre**: Stable `actionSAID` (fixed string is fine for tests).

**Steps (before grant)**
- Alice: `group create "Alice Private"` → **fail**

**Admin grants role**
- `users grant-role <aliceAid> user --adminAID <adminAid> --actionSAID <SAID>`

**Steps (after grant)**
- Alice: `group create "Alice Private"` → **ok**
- Alice: `group add <newGroupId> <bobAid> --role member` → **ok**

**Assert**
- Failure then success sequence; `group info` shows owner/admin/members

---

### 06) Allow/Deny Precedence
**Steps (Alice)**
1. `access allow <bobAid>` → default‑deny mode active
2. `send <bobAid> "ok"` → **ok**
3. `access deny <bobAid>`
4. `send <bobAid> "blocked"` → **fail**
5. `access list --allow/--deny` show presence
6. `access remove <bobAid> --deny`
7. `send <bobAid> "ok again"` → **ok**
8. `access clear --allow` → back to allow‑all

**Assert**
- Deny beats allow; lists reflect state transitions

---

### 07) Unread → Extract IDs → Mark as Read
**Steps**
- Bob → Alice: N DMs
- Alice: `unread` (N items)
- `extract-ids --file msgs.json`
- `mark-as-read --ids ...`
- Re‑`unread` → 0

**Assert**
- Counts match; previously returned IDs are not returned again

---

### 08) Forwarding / `--encrypt-for` (Optional)
**Steps**
- Alice → Admin with `--encrypt-for <bobAid>`
- Verify forwarding/decryption path according to your design

**Assert**
- Envelope metadata signals forwarding; Bob decrypts result

---

### 09) Watch/Stream (Optional/Slow)
**Steps**
- Start `unread --watch` (in background via test harness)
- Send a message; assert it appears
- Stop watcher

**Assert**
- Streaming emits expected message events

---

## CI Wiring

- **Env**: `MERITS_CONVEX_URL` → disposable test deployment (local or CI‑booted).
- **Make targets**:
  ```makefile
  e2e:
   \tbun test tests/e2e

  e2e:bash:
   \t./tests/e2e/run/*.sh
  ```
- **Serial execution**: run specs serially to avoid mailbox cross‑talk (or ensure distinct identities/data‑dirs).
- **Snapshots**: store under `tests/e2e/__snapshots__/`. Only snapshot **stable** fields; otherwise assert with jq or selective field comparisons.

---

## Test Scenario Priority & Status

### P0 Scenarios (Must Have) - Week 2

**Status: ❌ Not Implemented with In-Process Testing**

These scenarios are **critical** for validating core RBAC and messaging functionality:

1. **`tests/cli/e2e/incept-users.test.ts`**
   - Create admin, alice, bob with deterministic seeds
   - Verify session tokens returned with valid structure
   - Test `whoami` command shows active session
   - **Validates:** User inception flow, session management
   - **Estimated:** 2-3 hours

2. **`tests/cli/e2e/role-upgrade.test.ts`**
   - Admin grants 'user' role to alice using SAID
   - Verify alice can create groups (permission check passes)
   - Verify bob (still anon) cannot create groups (permission denied)
   - **Validates:** RBAC enforcement, role-based permissions
   - **Estimated:** 3-4 hours

3. **`tests/cli/e2e/group-permissions.test.ts`**
   - User creates cohort group
   - Add members (alice, bob) with different roles
   - Send/receive group messages
   - Verify encryption/decryption works
   - **Validates:** Group messaging, member permissions, encryption
   - **Estimated:** 3-4 hours

### P1 Scenarios (Should Have) - Week 3

**Status: ⚠️ Partially Implemented with Subprocess Testing**

4. **Bootstrap onboarding** (01)
   - Depends on bootstrap-plan.md implementation
   - Test secure or dev-only bootstrap flow
   - **Estimated:** 2-3 hours

5. **Default access for anon** (03)
   - Fresh users can only DM onboarding admins
   - DM to regular users denied
   - **Estimated:** 2 hours

6. **Cohort group messaging** (04)
   - Similar to P0 group test but more comprehensive
   - Test multi-message flows, read receipts
   - **Estimated:** 2-3 hours

### P2 Scenarios (Nice to Have) - Week 4

7. **Allow/deny precedence** (07)
   - Already tested at unit level
   - E2E validation of access control
   - **Estimated:** 2 hours

8. **Unread → mark-as-read pipeline** (08)
   - Partially implemented
   - Add comprehensive coverage
   - **Estimated:** 2 hours

9. **Forwarding/encrypt-for** (09)
   - Optional feature
   - Only if time permits
   - **Estimated:** 3-4 hours

### Current Test Coverage

**What Works Today (Subprocess Tests):**
- ✅ gen-key with deterministic seeds
- ✅ Output format tests (json, pretty, raw)
- ✅ Group encryption roundtrip
- ✅ Error handling for invalid inputs
- ✅ Utility commands (encrypt/decrypt/verify)
- ✅ Basic messaging flows

**What's Missing:**
- ❌ In-process test infrastructure
- ❌ RBAC role upgrade scenarios
- ❌ Comprehensive permission enforcement tests
- ❌ Bootstrap flow testing
- ❌ Standardized test workspace helpers
- ❌ Golden snapshots for most commands

---

## Implementation Checklist

### Phase 1: Infrastructure (Week 1) - 6-8 hours

**CLI Refactoring:**
- [ ] **`cli/build-program.ts`** (NEW) - Export `createMeritsProgram()` factory
- [ ] **`cli/index.ts`** - Refactor to use factory, keep as thin wrapper
- [ ] Verify existing CLI still works after refactoring

**Test Helpers:**
- [ ] **`tests/cli/helpers/exec.ts`** (NEW) - `runCliInProcess()` with Commander overrides
- [ ] **`tests/cli/helpers/exec.ts`** - Add output capture (stdout/stderr)
- [ ] **`tests/cli/helpers/exec.ts`** - Add JSON parsing with fallback
- [ ] **`tests/cli/helpers/workspace.ts`** (NEW) - `mkScenario()` for isolated test dirs
- [ ] **`tests/cli/helpers/workspace.ts`** - Add session token helpers
- [ ] **`tests/cli/helpers/workspace.ts`** - Add automatic cleanup

**Proof of Concept:**
- [ ] **`tests/cli/e2e/gen-key-inprocess.test.ts`** (NEW) - Migrate gen-key test
- [ ] Compare performance: subprocess vs. in-process
- [ ] Validate debugging experience (set breakpoints)
- [ ] **Decision point:** Proceed with full migration?

**Total Estimated Time:** 6-8 hours

---

### Phase 2: Priority Scenarios (Week 2-3) - 12-16 hours

**P0 Test Files:**
- [ ] **`tests/cli/e2e/incept-users.test.ts`** (NEW) - User inception flow
- [ ] **`tests/cli/e2e/role-upgrade.test.ts`** (NEW) - RBAC role assignment
- [ ] **`tests/cli/e2e/group-permissions.test.ts`** (NEW) - Group messaging + permissions

**Test Workspace:**
- [ ] Standardize on `mkScenario()` for all new tests
- [ ] Create scenario templates for common setups (admin+alice+bob)
- [ ] Document test patterns in README

**Golden Snapshots:**
- [ ] **`tests/cli/golden/incept.snap.json`** (NEW) - Incept command output
- [ ] **`tests/cli/golden/group-list.snap.json`** (NEW) - Group list format
- [ ] **`tests/cli/golden/key-for.snap.json`** (NEW) - Public key query
- [ ] Add normalization (replace timestamps, IDs)

**Total Estimated Time:** 12-16 hours

---

### Phase 3: Complete Migration (Week 4) - 8-12 hours

**Remaining Tests:**
- [ ] Migrate `tests/cli/e2e/new-cli-spec.test.ts` (large file, break into smaller)
- [ ] Migrate `tests/cli/integration/*.test.ts` to use in-process runner
- [ ] Remove subprocess-based tests (or keep as optional smoke tests)

**CI/CD:**
- [ ] Update `Makefile` test targets
- [ ] Update GitHub Actions workflows
- [ ] Document new test commands in README
- [ ] Set performance targets (total test time < 2min)

**Documentation:**
- [ ] **`tests/cli/README.md`** (NEW) - Testing guide
- [ ] Document in-process testing patterns
- [ ] Document test workspace conventions
- [ ] Add troubleshooting guide

**Total Estimated Time:** 8-12 hours

---

### Total Project Estimate

- **Week 1 (Infrastructure):** 6-8 hours
- **Week 2-3 (Priority Scenarios):** 12-16 hours
- **Week 4 (Migration & Documentation):** 8-12 hours
- **Total:** 26-36 hours (~1 week focused work or 3-4 weeks part-time)

---

## FAQ / Gotchas

- **Why not spawn a process?** In‑process keeps tests fast and reliable while still exercising full CLI wiring.
- **Commander exits my test!** Use `exitOverride()` exactly as shown; otherwise Commander calls `process.exit`.
- **Mixed output** (help + JSON): Commands should print a single JSON object when `--format json`. If you ever need multiple objects, print newline‑delimited JSON and parse per line in tests.
- **Time‑based fields**: avoid snapshotting exact timestamps; assert presence or normalize (e.g., replace with `"<TS>"` before snapshot).

---

## Status Checklist (per test file)

- Uses its **own** `--data-dir` and `--token`.
- Seeds pinned for any identity creation.
- Structural JSON assertions; errors verified by **code** and **message**.
- No state leakage between scenarios.
- Snapshots only for stable shapes.

---

Happy testing. This gives you black‑box confidence at unit‑test speeds—without sacrificing realism.
