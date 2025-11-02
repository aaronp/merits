# Implementation Roadmap: Bootstrap & CLI Testing

This document provides a **comprehensive timeline** for implementing both the secure bootstrap system and the in-process CLI testing infrastructure. It coordinates work across both initiatives, identifies dependencies, and provides decision points along the way.

---

## Executive Summary

**Two Parallel Initiatives:**
1. **Bootstrap Security** - Secure the admin bootstrap process
2. **CLI Testing** - Migrate to fast, in-process testing

**Timeline:** 4 weeks (or 26-36 hours focused work)

**Status:** Both initiatives are independent and can be done in parallel or sequentially based on your priorities.

---

## Current State Assessment

### What Works Today ✅

**Infrastructure:**
- Working CLI with 25+ commands
- RBAC schema with roles, permissions, assignments
- 119 passing tests (unit + integration + e2e)
- Test helpers for quick iteration (`grantAllPermissions`, `resetRBAC`)
- Subprocess-based E2E testing

**For Development:**
- Can create admin with `incept --seed admin-dev-seed`
- Can grant permissions with `grantAllPermissions()` test helper
- Fast iteration for development and testing

### Critical Gaps 🔴

**Security:**
- `bootstrapOnboarding()` mutation is WIDE OPEN (no authentication)
- No HMAC bootstrap token system
- No audit trail for RBAC operations
- First-run bypass allows unrestricted role creation

**Testing:**
- Subprocess tests are slow (~100ms per command)
- Hard to debug (can't set breakpoints)
- No standardized test workspace helpers
- Minimal golden snapshot coverage

---

## Decision Point: Choose Your Path

### Path A: Security First (Recommended for Production Planning)

**Timeline:** 3-4 weeks
**Focus:** Secure the bootstrap, then improve testing

**Week 1-2:** Implement secure bootstrap (Option A from bootstrap-plan.md)
**Week 3-4:** Add CLI testing infrastructure and RBAC test scenarios

**Best for:**
- Planning production deployment
- Security is immediate concern
- Want audit trail from day one

### Path B: Testing First (Recommended for Development Velocity)

**Timeline:** 3-4 weeks
**Focus:** Improve testing, then secure bootstrap

**Week 1-2:** Build in-process testing infrastructure + P0 scenarios
**Week 3-4:** Implement dev-only bootstrap (Option B) or secure bootstrap (Option A)

**Best for:**
- Development environment focus
- Want faster test feedback
- Security can wait (dev environment only)

### Path C: Parallel (Recommended for Small Team with Clear Ownership)

**Timeline:** 2-3 weeks
**Focus:** Work both initiatives simultaneously

**Developer 1:** Bootstrap security
**Developer 2:** CLI testing infrastructure

**Best for:**
- Multiple developers
- Want both done quickly
- Clear separation of concerns

### Path D: Minimal (Quick Wins Only)

**Timeline:** 1 week (8-12 hours)
**Focus:** Minimum viable improvements

**Quick Wins:**
- Add BOOTSTRAP_KEY check to existing mutation (4 hours)
- Create `runCliInProcess()` helper (4 hours)
- Write 1-2 P0 test scenarios (4-8 hours)

**Best for:**
- Time constrained
- Want immediate improvements
- Can iterate later

---

## Recommended Path: Path B (Testing First)

This roadmap recommends **Path B** because:
1. Better testing enables faster bootstrap implementation
2. Current dev setup works (even if insecure)
3. Can validate bootstrap with good tests
4. Production deployment likely 4-8 weeks away

**If your production deployment is imminent**, switch to **Path A**.

---

## Week-by-Week Breakdown (Path B)

### Week 1: CLI Testing Infrastructure

**Goal:** Create in-process testing foundation without breaking existing tests

**Monday-Tuesday (4-6 hours):**
- [ ] Create `cli/build-program.ts` factory function
- [ ] Refactor `cli/index.ts` to use factory
- [ ] Test that existing CLI still works
- [ ] Create `tests/cli/helpers/exec.ts` with `runCliInProcess()`
- [ ] Create `tests/cli/helpers/workspace.ts` with `mkScenario()`

**Wednesday-Thursday (4-6 hours):**
- [ ] Write proof-of-concept: migrate gen-key test to in-process
- [ ] Measure performance improvement (should be 10-100x faster)
- [ ] Test debugging experience (set breakpoints in command code)
- [ ] Document patterns in `tests/cli/README.md` (draft)

**Friday (2-4 hours):**
- [ ] **Decision point:** Performance and debugging improvements worth it?
- [ ] If yes: Proceed with P0 scenarios next week
- [ ] If no: Investigate issues, adjust approach

**Deliverables:**
- ✅ In-process test infrastructure working
- ✅ Proof-of-concept demonstrating benefits
- ✅ Decision made on full migration

**Files Created:**
- `cli/build-program.ts`
- `tests/cli/helpers/exec.ts`
- `tests/cli/helpers/workspace.ts`
- `tests/cli/e2e/gen-key-inprocess.test.ts` (POC)

---

### Week 2: Priority Test Scenarios

**Goal:** Implement P0 test scenarios using in-process infrastructure

**Monday-Tuesday (6-8 hours):**
- [ ] **P0 Scenario 1:** Incept users test
  - Create admin, alice, bob with deterministic seeds
  - Verify session tokens
  - Test `whoami` command
- [ ] Add golden snapshot for incept output
- [ ] Document test pattern

**Wednesday-Thursday (6-8 hours):**
- [ ] **P0 Scenario 2:** Role upgrade test
  - Admin grants 'user' role to alice
  - Verify alice can create groups
  - Verify bob (anon) cannot create groups
- [ ] Test permission denied errors
- [ ] Add assertions for error codes

**Friday (4-6 hours):**
- [ ] **P0 Scenario 3:** Group permissions test
  - User creates cohort group
  - Add members with different roles
  - Send/receive group messages
- [ ] Test encryption/decryption
- [ ] **Retrospective:** Test infrastructure working well?

**Deliverables:**
- ✅ 3 P0 test scenarios implemented
- ✅ RBAC enforcement validated
- ✅ Group messaging validated
- ✅ Golden snapshots for stable outputs

**Files Created:**
- `tests/cli/e2e/incept-users.test.ts`
- `tests/cli/e2e/role-upgrade.test.ts`
- `tests/cli/e2e/group-permissions.test.ts`
- `tests/cli/golden/incept.snap.json`
- `tests/cli/golden/group-list.snap.json`

---

### Week 3: Bootstrap Implementation

**Goal:** Implement dev-only bootstrap (Option B) or secure bootstrap (Option A)

**Decision Point:** Which bootstrap approach?

**Option B (Dev-Only Bootstrap - 1-2 days):**

**Monday-Tuesday (6-8 hours):**
- [ ] Add `rbac_flags` table to schema (optional but recommended)
- [ ] Update `convex/authorization_bootstrap.ts`:
  - Add BOOTSTRAP_KEY environment variable check
  - Add authentication requirement
  - Add idempotent bootstrap flag check
  - Create admin role and assign to caller
- [ ] Test bootstrap with and without BOOTSTRAP_KEY
- [ ] Document dev environment setup in README

**Wednesday (2-3 hours):**
- [ ] Write bootstrap test scenarios
- [ ] Test idempotent bootstrap
- [ ] Verify admin can perform admin operations

**Thursday-Friday (Optional):**
- [ ] Migrate more test files to in-process
- [ ] Add P1 test scenarios
- [ ] Documentation improvements

**Option A (Secure HMAC Bootstrap - 4-5 days):**

**Monday-Tuesday (8-10 hours):**
- [ ] Add `rbac_flags` and `rbac_audit` tables to schema
- [ ] Implement `verifyHmac()` function
- [ ] Add HMAC token validation to bootstrap mutation
- [ ] Add challenge-response binding
- [ ] Add bootstrap flag and audit trail

**Wednesday-Thursday (6-8 hours):**
- [ ] Update CLI: add `--data` and `--token-file` flags
- [ ] Create `tests/helpers/bootstrap-token.ts` with `mintBootstrapToken()`
- [ ] Forward token payload + signature to mutation

**Friday (4-6 hours):**
- [ ] Write comprehensive bootstrap test scenarios
- [ ] Add negative tests (invalid HMAC, expired token, etc.)
- [ ] Update CI/CD to set BOOTSTRAP_KEY secret

**Deliverables (Option B):**
- ✅ Dev-only bootstrap secured with environment check
- ✅ Bootstrap tests passing
- ✅ README updated with dev setup

**Deliverables (Option A):**
- ✅ Production-ready HMAC bootstrap
- ✅ Full audit trail
- ✅ Comprehensive negative tests
- ✅ CI/CD integration

---

### Week 4: Polish & Documentation

**Goal:** Complete migration, optimize, and document

**Monday-Tuesday (6-8 hours):**
- [ ] Migrate remaining E2E tests to in-process
- [ ] Break up large test files (new-cli-spec.test.ts)
- [ ] Add P1 test scenarios (default access, cohort messaging)

**Wednesday-Thursday (4-6 hours):**
- [ ] Update Makefile test targets
- [ ] Update GitHub Actions workflows
- [ ] Set performance targets and validate (< 2min total test time)
- [ ] Document any regressions or issues

**Friday (4-6 hours):**
- [ ] Write comprehensive testing guide (`tests/cli/README.md`)
- [ ] Update main README with bootstrap + testing sections
- [ ] Add troubleshooting guide
- [ ] Create operational runbook (if Option A bootstrap)

**Deliverables:**
- ✅ All tests migrated to in-process
- ✅ Comprehensive documentation
- ✅ CI/CD optimized
- ✅ Performance targets met

---

## Dependencies & Risks

### Dependencies

**CLI Testing → Bootstrap:**
- Better tests make bootstrap implementation faster to validate
- Can test bootstrap thoroughly with good test infrastructure
- **Recommended:** Build testing infrastructure first

**Bootstrap → CLI Testing:**
- Bootstrap tests need testing infrastructure
- If doing secure bootstrap, need test helpers for tokens
- **Can work around:** Use subprocess tests temporarily

### Risks & Mitigation

**Risk 1: In-process testing doesn't work as expected**
- **Mitigation:** Proof-of-concept in Week 1 validates approach
- **Fallback:** Keep subprocess tests, use in-process selectively

**Risk 2: HMAC bootstrap more complex than estimated**
- **Mitigation:** Start with Option B (dev-only), upgrade to Option A later
- **Fallback:** Document dev-only bootstrap as temporary solution

**Risk 3: Breaking existing tests during migration**
- **Mitigation:** Keep subprocess tests running in parallel during migration
- **Fallback:** Revert changes, use hybrid approach

**Risk 4: Time constraints (can't complete in 4 weeks)**
- **Mitigation:** Follow Path D (quick wins only)
- **Fallback:** Focus on P0 items only, defer P1/P2

---

## Success Criteria

### Week 1 (Testing Infrastructure)
- ✅ `runCliInProcess()` works for at least one command
- ✅ 10-100x performance improvement measured
- ✅ Can set breakpoints and debug command code
- ✅ Decision made to proceed or adjust approach

### Week 2 (Priority Scenarios)
- ✅ 3 P0 test scenarios implemented and passing
- ✅ RBAC enforcement validated (role upgrade test passes)
- ✅ Group messaging validated (group permissions test passes)
- ✅ Golden snapshots for stable command outputs

### Week 3 (Bootstrap)
- ✅ Bootstrap mutation requires authentication
- ✅ Bootstrap is idempotent (can call multiple times)
- ✅ Admin role created and assigned correctly
- ✅ Dev environment setup documented
- ✅ (Option A only) HMAC token system working with audit trail

### Week 4 (Polish)
- ✅ All E2E tests migrated to in-process
- ✅ Total test time < 2 minutes
- ✅ Comprehensive documentation completed
- ✅ CI/CD optimized and passing
- ✅ No regressions in test coverage

---

## Quick Wins (Can Do Immediately)

These can be done **right now** without waiting for full roadmap:

### Quick Win 1: Add BOOTSTRAP_KEY Check (2 hours)

```typescript
// convex/authorization_bootstrap.ts
export const bootstrapOnboarding = mutation({
  args: {},
  handler: async (ctx, args) => {
    // ⚡ QUICK WIN: Add this guard
    const BOOTSTRAP_KEY = process.env.BOOTSTRAP_KEY;
    if (!BOOTSTRAP_KEY) {
      throw new Error("BOOTSTRAP_DISABLED - Set BOOTSTRAP_KEY=dev in dev environment");
    }

    // ... rest of existing code ...
  }
});
```

**Impact:** Prevents accidental bootstrap in production

### Quick Win 2: Create mkScenario() Helper (1 hour)

```typescript
// tests/cli/helpers/workspace.ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function mkScenario(name: string) {
  const root = mkdtempSync(join(tmpdir(), `merits-${name}-`));
  const dataDir = join(root, ".merits");
  const sessionPath = join(dataDir, "session.json");

  mkdirSync(dataDir, { recursive: true });

  return {
    root,
    dataDir,
    sessionPath,
    cleanup: () => rmSync(root, { recursive: true, force: true })
  };
}
```

**Impact:** Standardize test isolation immediately

### Quick Win 3: Add Idempotent Check (1 hour)

```typescript
// convex/authorization_bootstrap.ts (in handler)

// ⚡ QUICK WIN: Check if already bootstrapped
const existingAdmin = await ctx.db
  .query("roles")
  .filter(q => q.eq(q.field("roleName"), "admin"))
  .first();

if (existingAdmin) {
  return { ok: true, already: true, message: "Already bootstrapped" };
}
```

**Impact:** Safe to call bootstrap multiple times

### Quick Win 4: Document Current Dev Setup (1 hour)

Add to README:

```markdown
## Dev Environment Setup (Current)

⚠️ **WARNING**: This is a development-only setup and NOT SECURE for production!

1. Set environment variable: `export BOOTSTRAP_KEY="dev-only-secret"`
2. Create admin identity: `merits incept --seed admin-dev-seed`
3. Bootstrap system: `merits rbac:bootstrap-onboarding`
4. Verify: `merits whoami`

For production deployment, see docs/bootstrap-plan.md Option A.
```

**Impact:** Clear documentation for dev setup

**Total Quick Wins Time:** 5-6 hours
**Total Impact:** Immediate security improvement + better dev experience

---

## Appendix: File Reference

### Files to Create (New)

**Testing Infrastructure:**
- `cli/build-program.ts` - Program factory
- `tests/cli/helpers/exec.ts` - In-process runner
- `tests/cli/helpers/workspace.ts` - Test isolation helpers
- `tests/cli/README.md` - Testing guide

**Test Scenarios:**
- `tests/cli/e2e/incept-users.test.ts`
- `tests/cli/e2e/role-upgrade.test.ts`
- `tests/cli/e2e/group-permissions.test.ts`
- `tests/cli/e2e/bootstrap-dev.test.ts` (or bootstrap-secure.test.ts)

**Bootstrap (Option A only):**
- `tests/helpers/bootstrap-token.ts` - Token minting helper
- `deploy/production.md` - Production deployment guide
- `docs/security.md` - Security model documentation
- `docs/operations.md` - Operational runbook

### Files to Modify (Existing)

**Testing Infrastructure:**
- `cli/index.ts` - Refactor to use factory
- Existing test files (gradual migration)

**Bootstrap:**
- `convex/schema.ts` - Add rbac_flags, rbac_audit tables
- `convex/authorization_bootstrap.ts` - Add security guards
- `cli/commands/rbac.ts` - Add token flags (Option A only)

**Documentation:**
- `README.md` - Add bootstrap and testing sections
- `docs/bootstrap-plan.md` - (Already updated)
- `docs/cli-test-strategy.md` - (Already updated)

---

## Next Steps

1. **Choose your path** (A, B, C, or D)
2. **Implement quick wins** (5-6 hours, immediate value)
3. **Start Week 1** based on chosen path
4. **Check in after each week** and adjust if needed

**Questions to answer:**
- What's your production deployment timeline?
- What's your availability (full-time vs. part-time)?
- Do you have multiple developers or working solo?
- Is security or testing velocity more urgent?

Your answers will determine the optimal path.
