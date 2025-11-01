## Permission/RBAC Redesign Plan

### Objective
Replace tier-based auth with roles/permissions (RBAC). Resolve user claims from roles and embed claims in session tokens. Bootstrap only what’s necessary; manage the rest via CLI.

### Scope
- Remove `tierConfigs`, `aidTiers`, `adminRoles`, and `convex/authorization.ts`.
- Add RBAC tables and permission checks across Convex mutations/queries.
- Embed resolved claims in `sessionTokens`.
- Minimal bootstrap: `onboarding` group, `anon` role, `can.message.groups` permission for the onboarding group.
- CLI: `gen-user`, `create`, `sign-challenge`, plus RBAC admin commands.

### Data Model (Convex)
- Remove: tier tables/indexes; delete `convex/authorization.ts`.
- Add in `convex/schema.ts`:
  - `users(aid unique, publicKey, createdAt)`
  - `roles(roleName unique, adminAID, actionSAID, timestamp)`
  - `permissions(key unique, data?, adminAID, actionSAID, timestamp)`
  - `rolePermissions(roleId -> roles, permissionId -> permissions, adminAID, actionSAID, timestamp)` with indexes on `roleId`, `permissionId`
  - `userRoles(userAID, roleId -> roles, adminAID, actionSAID, timestamp)` with indexes on `userAID`, `roleId`
  - Extend `sessionTokens` with `claims: [{ key, data? }]`
- Keep existing groups/messages.

### Permission Keys
- `can.message.groups` (data: [groupChatId])
- `can.read.groups` (data: [groupChatId])
- `can.create.groups`
- `can.update.groups`
- `can.delete.groups`
- `can.assign.users.to.groups`
- `can.assign.roles`

### Server Utilities
- `convex/permissions.ts`:
  - `resolveUserClaims(ctx, aid): Array<{ key, data? }>`
  - `claimsInclude(claims, key, predicate?) => boolean`

### Enforcement Points
- `convex/messages.ts`
  - Send to group: require `can.message.groups` including target `groupChatId`.
  - Read group messages: require `can.read.groups` including `groupChatId`.
- `convex/groups.ts`
  - Create group: `can.create.groups`
  - Update group: `can.update.groups`
  - Delete group: `can.delete.groups`
- Prefer session token’s embedded `claims` when available; fallback to `resolveUserClaims` for signed challenges.

### Auth + Sessions
- `convex/auth.ts`
  - `registerUser({ aid, publicKey, auth })` with purpose `"registerUser"`:
    - Insert `users` if not exists
    - Assign default role `anon`
- `convex/sessions.ts`
  - `openSession`: resolve claims and store in `sessionTokens.claims`
  - `validateSessionToken`: return `{ aid, ksn, sessionId, claims }` using stored claims

### Bootstrap (idempotent)
- `convex/authorization_bootstrap.ts`
  - `bootstrapOnboarding`:
    - Create `groupChats` named `onboarding` if missing
    - Create `roles.anon` if missing
    - Create `permissions.can.message.groups` with `data=[onboardingGroupId]` if missing
    - Map anon → that permission

### Admin RBAC Endpoints
- `convex/permissions_admin.ts`
  - `roles.create({ roleName, actionSAID, auth })` requires `can.assign.roles` or first-run bypass
  - `permissions.create({ key, data?, actionSAID, auth })` same requirement
  - `roles.addPermission({ roleName, key, actionSAID, auth })`
  - `users.grantRole({ userAID, roleName, actionSAID, auth })`
- Optionally reuse `groups.create` via `convex/groups.ts` for group management with `can.create.groups`.

### CLI
- `merits gen-user`
  - Generate AID + keypair; print `{ aid, publicKey, secretKey }`
- `merits create -aid <aid> -publicKey <publicKey>`
  - Request challenge for `"registerUser"` and print it
- `merits sign-challenge -aid <aid> -publicKey <publicKey> -challenge <signed>`
  - Prove challenge and call `registerUser`
- Admin:
  - `merits roles create <roleName>`
  - `merits permissions create <key> [--data <json>]`
  - `merits roles add-permission <roleName> <key>`
  - `merits users grant-role <aid> <roleName>`
  - `merits groups create <name> --ownerAid <aid>`

### Acceptance Criteria
- Roles/permissions tables exist; tier tables and `convex/authorization.ts` removed.
- New users can be created via CLI flow and end with role `anon`.
- `bootstrapOnboarding` creates onboarding group, `anon` role, and permission mapping; idempotent.
- Sending to any group other than onboarding fails for anon; sending to onboarding succeeds.
- Session tokens embed claims; message/group checks pass using token without DB claim recompute.
- Admin can create roles/permissions, map them, and grant roles via CLI; effects reflect in new sessions.
- Docs updated (`docs/permissions.md` and this plan) to reflect tables, flows, and CLI.

### Test Plan (links added as implemented)
- Unit
  - `tests/unit/sdk.test.ts`: session claims behavior
  - `tests/unit/router.test.ts`: permission enforcement paths
- Integration
  - `tests/integration/auth-integration.test.ts`: register user via challenge flow
  - `tests/integration/group-chat.test.ts`: anon can only message onboarding group
  - `tests/integration/router-integration.test.ts`: session token claims honored
  - `tests/integration/identity-auth-interface.test.ts`: no tier dependencies remain
- CLI E2E
  - `tests/cli/e2e/messaging.test.ts`: adjusted for RBAC
  - `tests/cli/e2e/watch.test.ts`: adjusted session path
- New
  - `tests/integration/rbac-admin.test.ts`: roles/permissions CRUD and assignment via CLI
  - `tests/integration/bootstrap-onboarding.test.ts`: idempotent bootstrap

### Traceability
- Schema: `convex/schema.ts`
- Permissions utils: `convex/permissions.ts`
- Auth + sessions: `convex/auth.ts`, `convex/sessions.ts`
- Enforcement: `convex/messages.ts`, `convex/groups.ts`
- Bootstrap: `convex/authorization_bootstrap.ts`
- Admin APIs: `convex/permissions_admin.ts`
- CLI: `cli/commands/*`


