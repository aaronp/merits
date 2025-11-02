# Secure Bootstrap Plan for Merits (Onboarding + Admin)

This plan describes a **deterministic, test-friendly** bootstrap process that **does not introduce a production backdoor**. It enables creating an initial **onboarding group**, **roles/permissions**, and assigning the first **admin** safely, while supporting reproducible e2e tests.

---

## 🚨 CRITICAL: Current State & Security Issue

### What Exists Now

**Implementation:** `/convex/authorization_bootstrap.ts`
- ✅ `bootstrapOnboarding()` mutation creates onboarding group + anon role
- ✅ RBAC schema with `roles`, `permissions`, `rolePermissions`, `userRoles` tables
- ✅ CLI command: `merits rbac:bootstrap-onboarding`
- ✅ Idempotent (checks if roles exist before creating)

**Test Helpers:** `/convex/testHelpers.ts`
- ✅ `grantAllPermissions(aid)` - Creates test_admin role with all permissions
- ✅ `resetRBAC()` - Deletes all RBAC data for clean test state
- ✅ `registerTestUser(aid, publicKey)` - Bypasses challenge-response for tests

### 🔴 CRITICAL SECURITY GAP

**The `bootstrapOnboarding()` mutation is WIDE OPEN:**
- ❌ No authentication required
- ❌ No bootstrap token verification
- ❌ No HMAC signature check
- ❌ Anyone can call it if RBAC is empty
- ❌ **This is a production backdoor risk!**

**First-Run Bypass:** `/convex/permissions_admin.ts`
- If no roles/permissions exist, `requireAssignRoles()` allows creation without checks
- This is intentional for initial setup but creates a security window

### Migration Path

This document presents **two approaches**:

1. **Option A (Secure - Recommended for Production):** Full HMAC token bootstrap with challenge-response binding
2. **Option B (Simple - Dev/Testing Only):** Enhanced current system with environment checks

Choose based on your deployment timeline and security requirements.

---

## Objectives

- Deterministic admin in tests via `admin-test-seed` (local only).
- Server-side **HMAC bootstrap token** is required to perform bootstrap (Option A).
- Bootstrap is **one-time** and **idempotent**; impossible once RBAC is non-empty or key is removed.
- All sensitive mutations remain protected by RBAC; bootstrap only sets initial state.

---

## Threat Model (Summary)

- Knowing `admin-test-seed` **must not** be sufficient to gain admin.
- Only callers who present a valid **bootstrap token** (HMAC verified using **server secret**) and are authenticated as the intended AID can bootstrap.
- After bootstrap, remove/disable the server secret so the path is closed.
- All other RBAC mutations demand explicit permissions (`rbac:*` or specific keys).

---

## Data & Collections (Convex)

### Existing Schema (`/convex/schema.ts`)

✅ **Already Implemented:**
- `roles { _id, roleName, adminAID, actionSAID, createdAt }`
- `permissions { _id, key, data?, adminAID, actionSAID, createdAt }`
- `rolePermissions { _id, roleId, key, adminAID, actionSAID, createdAt }`
- `userRoles { _id, userId, roleId, adminAID, actionSAID, createdAt }`

✅ **Existing Indexes:**
- `roles.by_roleName (roleName)`
- `permissions.by_key (key)`
- `userRoles.by_user (userId)`
- `rolePermissions.by_roleId (roleId)`

### 🔴 Missing Schema (Needed for Secure Bootstrap)

❌ **Need to Add:**
- `rbac_flags { _id, key, state, at, byAid }` - Bootstrap status tracking
- `rbac_audit { _id, typ, byAid, at, payload }` - Audit trail for all RBAC operations

❌ **Need to Add Indexes:**
- `rbac_flags.by_key (key)` - For fast bootstrap status lookup

### Schema Addition Code

Add to `/convex/schema.ts`:

```typescript
rbac_flags: defineTable({
  key: v.string(),        // e.g., "bootstrapStatus"
  state: v.string(),      // e.g., "done", "in_progress"
  at: v.number(),         // timestamp
  byAid: v.string(),      // who performed the action
}).index("by_key", ["key"]),

rbac_audit: defineTable({
  typ: v.string(),        // e.g., "BOOTSTRAP_DONE", "ROLE_GRANTED"
  byAid: v.string(),      // actor AID
  at: v.number(),         // timestamp
  payload: v.any(),       // operation details
}),
```

---

## Bootstrap Token (HMAC)

- Server env var: `BOOTSTRAP_KEY` (present in CI/dev; absent/rotated in prod after first bootstrap).
- Token payload:
  ```json
  { "purpose":"rbac_bootstrap", "aid":"<callerAid>", "exp": 1730538000000, "nonce":"<random>" }
  ```
- Signature: `sig = base64url(HMAC_SHA256(JSON(payload), BOOTSTRAP_KEY))`

**Validation rules**
- `purpose === "rbac_bootstrap"`
- `exp` within acceptable window
- HMAC matches
- Caller’s authenticated AID equals `payload.aid`

---

## Implementation Options

### Option A: Secure HMAC Bootstrap (Recommended for Production)

**Use When:**
- Deploying to production or staging
- Need provable security guarantees
- Want audit trail of bootstrap operation
- Multi-environment deployment (dev, staging, prod)

**Security Properties:**
- ✅ Requires HMAC token signed with server secret
- ✅ Challenge-response authentication required
- ✅ AID binding (caller must match token)
- ✅ Time-limited token (short expiry window)
- ✅ One-time use (bootstrap flag prevents reuse)
- ✅ Full audit trail

**Implementation Effort:** 2-3 days
**Files to Modify:** 8-10 files (see Implementation Checklist below)

### Option B: Simple Dev Bootstrap (Testing/Dev Only)

**Use When:**
- Local development environment only
- Fast iteration more important than security
- Willing to secure before production
- Using test helpers like `grantAllPermissions()` is acceptable

**Security Properties:**
- ⚠️ Environment variable guard only
- ⚠️ Basic authentication check (session token)
- ⚠️ No HMAC verification
- ⚠️ **NOT SUITABLE FOR PRODUCTION**

**Implementation Effort:** 4-6 hours
**Files to Modify:** 2-3 files

**Quick Implementation for Option B:**

1. Update `/convex/authorization_bootstrap.ts`:
```typescript
export const bootstrapOnboarding = mutation({
  args: {},
  handler: async (ctx, args) => {
    // Guard: Require BOOTSTRAP_KEY in environment
    const BOOTSTRAP_KEY = process.env.BOOTSTRAP_KEY;
    if (!BOOTSTRAP_KEY) {
      throw new Error("BOOTSTRAP_DISABLED - Bootstrap not available in this environment");
    }

    // Guard: Require authentication
    const callerAid = await getCurrentUserAid(ctx);
    if (!callerAid) {
      throw new Error("AUTH_REQUIRED - Must be authenticated to bootstrap");
    }

    // Idempotent: Check if already bootstrapped
    const existingAdmin = await ctx.db
      .query("roles")
      .filter(q => q.eq(q.field("roleName"), "admin"))
      .first();

    if (existingAdmin) {
      return { ok: true, already: true };
    }

    // ... rest of bootstrap logic ...
  }
});
```

2. Document in README:
```markdown
## Dev Environment Setup

⚠️ **WARNING**: This bootstrap is DEV ONLY and NOT SECURE for production!

1. Set environment variable: `export BOOTSTRAP_KEY="dev-only-secret"`
2. Create admin identity: `merits incept --seed admin-dev-seed`
3. Bootstrap: `merits rbac:bootstrap-onboarding`
4. Admin AID will have full permissions
```

---

## Option A: Secure HMAC Bootstrap (Full Implementation)

The following sections describe the **complete secure bootstrap** system. Skip to "Option B Quick Start" above if using the simple dev-only approach.

---

## Convex Mutation: `rbac.bootstrapOnboarding` (Option A)

**Guards (all must pass):**
1. RBAC **empty**: no roles, permissions, or assignments exist.
2. `BOOTSTRAP_KEY` present and token is valid (HMAC, purpose, exp).
3. Caller is authenticated; AID matches `payload.aid`.
4. Idempotence: if already bootstrapped, respond `{ ok: true, already: true }`

**Creates:**
- Roles: `anon`, `user`, `admin`
- Permissions (example set; adjust to your policy):
  - `group:create`
  - `group:add-member`
  - `message:send:direct`
  - `message:send:group`
  - `rbac:grant-role`
  - `rbac:add-permission`
- Role-permissions:
  - `admin` → `group:*`, `rbac:*`, `message:*`
  - `anon` → `message:send:onboarding-admins` (restrictive default)
- Assignment: caller AID → `admin`
- Group: `"Onboarding"` owned by caller admin
- Flags: `bootstrapStatus = done`
- Audit entry

**Pseudo-code**
```ts
import { mutation } from "./_generated/server";
import { v } from "convex/values";
import crypto from "node:crypto";

const WINDOW_MS = 10 * 60 * 1000;

function verifyHmac(payload: any, sig: string, key: string) {
  const data = JSON.stringify(payload);
  const mac = crypto.createHmac("sha256", key).update(data).digest("base64url");
  return crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(sig));
}

export const bootstrapOnboarding = mutation({
  args: {
    payload: v.object({
      purpose: v.literal("rbac_bootstrap"),
      aid: v.string(),
      exp: v.number(),
      nonce: v.string(),
    }),
    sig: v.string(),
  },
  handler: async (ctx, { payload, sig }) => {
    const now = Date.now();
    const key = process.env.BOOTSTRAP_KEY;
    if (!key) throw new Error("BOOTSTRAP_DISABLED");

    // Idempotent
    const existing = await ctx.db
      .query("rbac.flags").withIndex("by_key", q => q.eq("key","bootstrapStatus")).unique();
    if (existing?.state === "done") return { ok: true, already: true };

    // Empty RBAC?
    const [roles, perms, assigns] = await Promise.all([
      ctx.db.query("rbac.roles").collect(),
      ctx.db.query("rbac.permissions").collect(),
      ctx.db.query("rbac.assignments").collect(),
    ]);
    if (roles.length + perms.length + assigns.length > 0) throw new Error("RBAC_NOT_EMPTY");

    // Token checks
    if (payload.purpose !== "rbac_bootstrap") throw new Error("BOOTSTRAP_BAD_PURPOSE");
    if (payload.exp < now || payload.exp > now + WINDOW_MS) throw new Error("BOOTSTRAP_TOKEN_EXPIRED");
    if (!verifyHmac(payload, sig, key)) throw new Error("BOOTSTRAP_BAD_SIG");

    // Auth: bind caller
    const callerAid = await requireCallerAid(ctx); // implement using your session auth
    if (callerAid !== payload.aid) throw new Error("AID_MISMATCH");

    // Create RBAC baseline
    const mkRole = (name: string) => ctx.db.insert("rbac.roles", { name, createdAt: now });
    const [anonRoleId, userRoleId, adminRoleId] = await Promise.all([
      mkRole("anon"), mkRole("user"), mkRole("admin"),
    ]);
    const P = (key: string, data?: any) => ctx.db.insert("rbac.permissions", { key, data, createdAt: now });

    await Promise.all([
      P("group:create"),
      P("group:add-member"),
      P("message:send:direct"),
      P("message:send:group"),
      P("rbac:grant-role"),
      P("rbac:add-permission"),
    ]);

    const grant = (roleId: string, key: string) =>
      ctx.db.insert("rbac.rolePermissions", { roleId, key });
    await Promise.all([
      grant(adminRoleId, "group:*"),
      grant(adminRoleId, "rbac:*"),
      grant(adminRoleId, "message:*"),
      grant(anonRoleId, "message:send:onboarding-admins"),
    ]);

    await ctx.db.insert("rbac.assignments", { aid: callerAid, roleId: adminRoleId, createdAt: now });

    const onboardingGroupId = await ctx.db.insert("groups", {
      name: "Onboarding", ownerAid: callerAid, description: "System onboarding", createdAt: now
    });

    await ctx.db.insert("rbac.flags", { key: "bootstrapStatus", state: "done", at: now, byAid: callerAid });
    await ctx.db.insert("rbac.audit", { typ: "BOOTSTRAP_DONE", byAid: callerAid, at: now, payload });

    return { ok: true, onboardingGroupId, adminAid: callerAid };
  }
});
```

---

## Client/Test Helper: Mint Bootstrap Token

```ts
// tests/e2e/helpers/bootstrap.ts
import crypto from "node:crypto";

export function mintBootstrapToken(aid: string, key = process.env.BOOTSTRAP_KEY!) {
  if (!key) throw new Error("BOOTSTRAP_KEY missing in env");
  const payload = {
    purpose: "rbac_bootstrap",
    aid,
    exp: Date.now() + 5 * 60 * 1000,
    nonce: crypto.randomBytes(16).toString("base64url"),
  };
  const sig = crypto.createHmac("sha256", key).update(JSON.stringify(payload)).digest("base64url");
  return { payload, sig };
}
```

---

## CLI Additions

- Keep your existing `rbac:bootstrap-onboarding` command; add an option to pass token:
  - `--data <json>` (inline) **or** `--token-file <path>`
- Command forwards payload+sig to the Convex mutation.

**Example (tests):**
```ts
const admin = await runCliInProcess([...base, "incept", "--seed", "admin-test-seed"]);
const adminAid = (admin.json as any).aid;
const token = mintBootstrapToken(adminAid); // requires BOOTSTRAP_KEY in env

const r = await runCliInProcess([
  ...base,
  "rbac:bootstrap-onboarding",
  "--data", JSON.stringify(token)
]);
expect(r.code).toBe(0);
```

---

## End-to-End Bootstrap Flow (CI/Dev)

1) **Admin identity** (deterministic, local only):  
   `merits incept --seed admin-test-seed`
2) **Mint token** with `BOOTSTRAP_KEY` (CI secret):  
   `mintBootstrapToken(<adminAid>)`
3) **Bootstrap**:  
   `merits rbac:bootstrap-onboarding --data '<payload+sig>'`
4) Proceed with other scenarios (incept Alice/Bob, cohort groups, role upgrades…)

**Idempotent**: re-running returns `{ ok: true, already: true }`.

---

## Guardrails / Production Posture

- **Disable after use**: remove/rotate `BOOTSTRAP_KEY` in production.
- **Require empty RBAC**: mutation refuses if any RBAC data exists.
- **Strict token checks**: purpose, HMAC, short expiry window, AID match.
- **Optional replay defense**: store and reject previously used `nonce` until `exp` passes.
- **Audit everything**: write audit entries for bootstrap, role grants, permission changes.
- **Permission gates**: ensure all sensitive mutations check role permissions (deny by default).

---

## Negative Tests (Must-Have)

- Missing `BOOTSTRAP_KEY` → `BOOTSTRAP_DISABLED`.
- Bad HMAC → `BOOTSTRAP_BAD_SIG`.
- Expired token → `BOOTSTRAP_TOKEN_EXPIRED`.
- RBAC not empty → `RBAC_NOT_EMPTY`.
- AID mismatch → `AID_MISMATCH`.
- Non-admin attempts to `users grant-role` → `AUTH_FORBIDDEN`.
- Non-admin attempts to `permissions create` → `AUTH_FORBIDDEN`.

---

## Implementation Checklist

### Option B (Simple Dev Bootstrap) - 4-6 hours

**Schema Changes:**
- [ ] **`convex/schema.ts`** - Add `rbac_flags` table with `by_key` index (optional but recommended)

**Backend Changes:**
- [ ] **`convex/authorization_bootstrap.ts`** - Add BOOTSTRAP_KEY check
- [ ] **`convex/authorization_bootstrap.ts`** - Add authentication requirement
- [ ] **`convex/authorization_bootstrap.ts`** - Add idempotent bootstrap flag check
- [ ] **`convex/authorization_bootstrap.ts`** - Create admin role + assign caller

**Documentation:**
- [ ] **`README.md`** - Add dev environment setup section
- [ ] **`README.md`** - Add WARNING about dev-only bootstrap

**Testing:**
- [ ] **`tests/cli/e2e/bootstrap-dev.test.ts`** - Test bootstrap with BOOTSTRAP_KEY
- [ ] **`tests/cli/e2e/bootstrap-dev.test.ts`** - Test bootstrap without key (should fail)
- [ ] **`tests/cli/e2e/bootstrap-dev.test.ts`** - Test idempotent bootstrap

**Total Estimated Time:** 4-6 hours

---

### Option A (Secure HMAC Bootstrap) - 2-3 days

**Schema Changes:**
- [ ] **`convex/schema.ts`** - Add `rbac_flags` table with `by_key` index
- [ ] **`convex/schema.ts`** - Add `rbac_audit` table

**Backend Changes:**
- [ ] **`convex/authorization_bootstrap.ts`** - Add `verifyHmac()` function
- [ ] **`convex/authorization_bootstrap.ts`** - Add HMAC token validation
- [ ] **`convex/authorization_bootstrap.ts`** - Add challenge-response binding
- [ ] **`convex/authorization_bootstrap.ts`** - Add bootstrap flag check
- [ ] **`convex/authorization_bootstrap.ts`** - Add audit trail entries
- [ ] **`convex/authorization_bootstrap.ts`** - Create admin, user, anon roles
- [ ] **`convex/authorization_bootstrap.ts`** - Create permission wildcards (or specific permissions)
- [ ] **`convex/authorization_bootstrap.ts`** - Assign caller to admin role

**CLI Changes:**
- [ ] **`cli/commands/rbac.ts`** - Add `--data` flag to bootstrap command
- [ ] **`cli/commands/rbac.ts`** - Add `--token-file` flag (optional)
- [ ] **`cli/commands/rbac.ts`** - Forward token payload + signature to mutation

**Test Helpers:**
- [ ] **`tests/helpers/bootstrap-token.ts`** (NEW) - `mintBootstrapToken(aid, key?)` function
- [ ] **`tests/helpers/bootstrap-token.ts`** - Export for use in e2e tests

**E2E Tests:**
- [ ] **`tests/cli/e2e/bootstrap-secure.test.ts`** (NEW) - Full bootstrap flow
- [ ] **`tests/cli/e2e/bootstrap-secure.test.ts`** - Test with valid token
- [ ] **`tests/cli/e2e/bootstrap-secure.test.ts`** - Negative: missing BOOTSTRAP_KEY
- [ ] **`tests/cli/e2e/bootstrap-secure.test.ts`** - Negative: invalid HMAC
- [ ] **`tests/cli/e2e/bootstrap-secure.test.ts`** - Negative: expired token
- [ ] **`tests/cli/e2e/bootstrap-secure.test.ts`** - Negative: RBAC not empty
- [ ] **`tests/cli/e2e/bootstrap-secure.test.ts`** - Negative: AID mismatch
- [ ] **`tests/cli/e2e/bootstrap-secure.test.ts`** - Test idempotent bootstrap

**CI/CD:**
- [ ] **`.github/workflows/test.yml`** - Set `BOOTSTRAP_KEY` secret for e2e tests
- [ ] **`deploy/production.md`** (NEW) - Document bootstrap procedure
- [ ] **`deploy/production.md`** - Document key rotation/removal

**Documentation:**
- [ ] **`README.md`** - Update with secure bootstrap procedure
- [ ] **`docs/security.md`** (NEW) - Security model documentation
- [ ] **`docs/operations.md`** (NEW) - Operational runbook

**Total Estimated Time:** 2-3 days

---

### Current State (What Works Today)

**For Development/Testing (Current Approach):**
```typescript
// In tests or dev setup scripts:
import { api } from "./convex/_generated/api";
import { ConvexMeritsClient } from "./src/client/convex";

// 1. Create admin identity
const admin = await runCliInProcess(["incept", "--seed", "admin-dev-seed"]);
const adminAid = admin.json.aid;

// 2. Grant all permissions (test helper)
await testConvexClient.mutation(internal.testHelpers.grantAllPermissions, {
  aid: adminAid
});

// 3. Admin can now perform any operation
```

**This approach:**
- ✅ Works for tests and local dev
- ✅ Fast and simple
- ✅ Deterministic (using seed)
- ⚠️ Bypasses all security checks
- ❌ Not suitable for production
- ❌ No audit trail

---

## Notes

- The **seed** is only a convenience to reproduce the admin AID locally. **Authority comes solely from** possession of a valid bootstrap token + successful authentication.
- You can change `Onboarding` group name/permissions as policy evolves; the guards remain the same.

---

**Done right, this provides deterministic tests and a safe, one-time bootstrap in production, with no standing backdoor.**
