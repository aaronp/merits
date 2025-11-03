# Test Suite Review & Modernization Plan

## Executive Summary

**Goal**: Streamline tests to focus on CLI E2E tests (CLI → Merits API → Backend), remove redundant tests, use code coverage to identify dead code, and eliminate all `setTimeout` in favor of `eventually()`.

**Principles**:
- CLI E2E tests are the primary test layer
- All tests should be fast (negative assertions: ~300ms)
- Use `eventually()` for async polling, never `setTimeout`
- Centralize timeouts in `tests/config.ts`
- Use code coverage to guide deletion

---

## Current Test Structure

```
tests/
├── cli/
│   ├── e2e/              ✅ PRIMARY: Keep & modernize
│   ├── unit/             ⚠️  Review: May be redundant
│   ├── integration/      ⚠️  Review: May be redundant
│   ├── golden/           ❓ Review usage
│   └── performance/      ⚠️  Keep but separate
├── integration/          ❌ REDUNDANT: Covered by CLI E2E
├── unit/                 ⚠️  Review: Core logic only
└── helpers/              ✅ Keep utilities
```

---

## Test Categories

### ✅ KEEP: CLI E2E Tests (Primary)

**Location**: `tests/cli/e2e/`

These test the full stack: CLI → API → Backend

**Files**:
- `group-messaging.test.ts` - ✅ Already modernized with tokens
- `direct-messaging.test.ts` - ⚠️  Needs update: Replace setTimeout
- `incept-users.test.ts`
- `sign-in-flow.test.ts`
- `role-upgrade.test.ts`
- `unread-pipeline.test.ts` - ⚠️  Needs update: Replace setTimeout
- `watch.test.ts` - ✅ Already uses eventually
- `allow-deny-lists.test.ts`
- `default-access.test.ts`
- `bootstrap.test.ts`
- `messaging.test.ts`
- `encryption-utilities.test.ts`
- `gen-key-inprocess.test.ts`
- `new-cli-spec.test.ts`

**Action Items**:
1. Replace all `setTimeout` with `eventually()` from `tests/helpers/eventually.ts`
2. Use `TEST_CONFIG.NEGATIVE_ASSERTION_TIMEOUT` (300ms) for "should NOT receive" tests
3. Use `TEST_CONFIG.EVENTUALLY_TIMEOUT` (5000ms) for "should receive" tests
4. Ensure all tests use token-based auth (follow `group-messaging.test.ts` pattern)

---

### ⚠️  REVIEW: Integration Tests

**Location**: `tests/integration/`

These bypass the CLI and call the API directly. **Likely redundant** since CLI E2E tests cover the same paths.

**Files**:
- `allow-deny-list.test.ts` - Covered by `cli/e2e/allow-deny-lists.test.ts`?
- `allow-deny-list-simple.test.ts` - Covered by CLI E2E?
- `auth-integration.test.ts` - Covered by `cli/e2e/sign-in-flow.test.ts`?
- `identity-auth-interface.test.ts` - Low-level, might keep
- `integration.test.ts` - Covered by CLI E2E?
- `key-for.test.ts` - Low-level, might keep
- `messaging-flow.test.ts` - Covered by `cli/e2e/messaging.test.ts`?
- `router-integration.test.ts` - Low-level routing logic
- `transport-interface.test.ts` - Low-level transport

**Action**:
1. Run code coverage with only CLI E2E tests
2. Identify any code NOT covered by CLI E2E
3. Delete redundant integration tests
4. Keep only tests that cover unique low-level logic (e.g., `key-for`, `router`, `transport`)

---

### ⚠️  REVIEW: Unit Tests

**Location**: `tests/unit/`

Core logic tests that don't require backend.

**Files**:
- `crypto.test.ts` - ✅ Keep: Core crypto primitives
- `router.test.ts` - ✅ Keep: Routing logic
- `sdk.test.ts` - ❓ Review: Covered by E2E?
- `signature-debug.test.ts` - ❓ Debugging test, delete?
- `timestamp-fix.test.ts` - ❓ Bug fix test, delete if no longer needed?
- `end-to-end-simple.test.ts` - ❓ Covered by E2E?

**Action**:
1. Keep `crypto.test.ts` and `router.test.ts` (pure logic)
2. Review others with code coverage
3. Delete if covered by CLI E2E

---

### ⚠️  REVIEW: CLI Unit/Integration

**Location**: `tests/cli/unit/`, `tests/cli/integration/`

**Files**:
- `cli/unit/config.test.ts` - ✅ Keep: Config parsing logic
- `cli/unit/formatters.test.ts` - ✅ Keep: Output formatting
- `cli/unit/messaging-auth.test.ts` - ❓ Covered by E2E?
- `cli/unit/vault.test.ts` - ❓ Covered by E2E?
- `cli/integration/messaging.test.ts` - ❌ Delete: Covered by E2E

**Action**:
Keep config/formatter tests, review others with coverage

---

### ❓ REVIEW: Performance Tests

**Location**: `tests/cli/performance/`

**Files**:
- `group-encryption-performance.test.ts`
- `subprocess-vs-inprocess.test.ts`

**Action**: Keep but run separately from main test suite

---

### ❓ REVIEW: Golden Tests

**Location**: `tests/cli/golden/`

**Files**:
- `golden-snapshot.test.ts`

**Action**: Review if still needed, keep if actively maintained

---

## setTimeout → eventually() Migration

### Pattern: Positive Assertions (Message SHOULD arrive)

**Before**:
```typescript
// Wait for message
await new Promise((resolve) => setTimeout(resolve, 1000));

const messages = await runCliInProcess(["unread", "--token", tokenPath], {...});
expect(messages.json.length).toBeGreaterThan(0);
```

**After**:
```typescript
import { eventuallyValue } from "../../helpers/eventually";
import { TEST_CONFIG } from "../../config";

const messages = await eventuallyValue(
  async () => {
    const result = await runCliInProcess(["unread", "--token", tokenPath], {...});
    return result.json.length > 0 ? result.json : null;
  },
  { timeout: TEST_CONFIG.EVENTUALLY_TIMEOUT }
);

expect(messages.length).toBeGreaterThan(0);
```

### Pattern: Negative Assertions (Message should NOT arrive)

**Before**:
```typescript
// Wait to ensure no message
await new Promise((resolve) => setTimeout(resolve, 1000));

const messages = await runCliInProcess(["unread", "--token", tokenPath], {...});
expect(messages.json.length).toBe(0);
```

**After**:
```typescript
import { eventually } from "../../helpers/eventually";
import { TEST_CONFIG } from "../../config";

// Poll for a short time to ensure message does NOT arrive
let receivedMessage = false;

try {
  await eventually(
    async () => {
      const result = await runCliInProcess(["unread", "--token", tokenPath], {...});
      return result.json.length > 0;
    },
    { timeout: TEST_CONFIG.NEGATIVE_ASSERTION_TIMEOUT } // 300ms
  );
  receivedMessage = true;
} catch (err) {
  // Timeout is expected - message should NOT have arrived
}

expect(receivedMessage).toBe(false);
```

---

## Action Plan

### Phase 1: Centralize Configuration ✅
- [x] Create `tests/config.ts` with centralized timeouts
- [x] Document timeout values and rationale

### Phase 2: Modernize CLI E2E Tests
- [ ] Update `direct-messaging.test.ts` - replace setTimeout
- [ ] Update `unread-pipeline.test.ts` - replace setTimeout
- [ ] Update all E2E tests to use `TEST_CONFIG` constants
- [ ] Ensure all use token-based auth pattern

### Phase 3: Run Code Coverage
- [ ] Run coverage with only CLI E2E tests: `bun test --coverage tests/cli/e2e/`
- [ ] Generate coverage report
- [ ] Identify uncovered code paths

### Phase 4: Delete Redundant Tests
- [ ] Delete `tests/integration/` tests covered by E2E
- [ ] Delete `tests/cli/integration/` tests covered by E2E
- [ ] Delete `tests/unit/` tests covered by E2E
- [ ] Keep only unique low-level tests (crypto, router, config, formatters)

### Phase 5: Delete Dead Code
- [ ] Use coverage report to identify dead code
- [ ] Delete unused functions/modules
- [ ] Add targeted tests for any critical uncovered paths

### Phase 6: Performance Baseline
- [ ] Measure test suite execution time
- [ ] Target: <10 seconds for full E2E suite
- [ ] Target: <300ms for negative assertions

---

## Migration Examples

### File: `tests/cli/e2e/direct-messaging.test.ts`

**Lines with setTimeout**:
- Line 240: `await new Promise((resolve) => setTimeout(resolve, 1000));`
- Line 290: `await new Promise((resolve) => setTimeout(resolve, 1000));`
- Line 320: `await new Promise((resolve) => setTimeout(resolve, 1000));`

**Migration**: Replace with `eventuallyValue()` pattern shown above

### File: `tests/cli/e2e/unread-pipeline.test.ts`

**Lines with setTimeout**:
- Line 150: `await new Promise((resolve) => setTimeout(resolve, 1000));`
- Line 200: `await new Promise((resolve) => setTimeout(resolve, 1000));`

**Migration**: Replace with `eventuallyValue()` pattern shown above

---

## Success Metrics

1. **Test Speed**:
   - E2E suite completes in <10 seconds
   - Negative assertions complete in ~300ms
   - No setTimeout anywhere in test code

2. **Test Coverage**:
   - 80%+ code coverage from CLI E2E tests alone
   - Remaining code either deleted or covered by unit tests

3. **Test Maintainability**:
   - Single test layer (CLI E2E) for most functionality
   - Centralized timeout configuration
   - Clear patterns for async assertions
