# Permissions

**Merits v0.1.0** has a simple permission model: any registered AID can message any other registered AID. Advanced ACLs and rate limiting are planned but not yet enforced.

## Current Model (v0.1.0)

### Direct Messaging

**Who can send**:
- ✅ Any registered AID (public key in `keyStates` table)
- ✅ Must prove control via challenge/response auth
- ❌ No allowlist/blocklist (future)
- ❌ No rate limiting (future)

**Who can receive**:
- ✅ Any registered AID
- ✅ Messages delivered to `recpAid` inbox
- ❌ No filtering (future)

**Example**:
```typescript
// Alice can send to Bob if both are registered
await client.transport.sendMessage({
  to: bob.aid,
  ct: encrypt("Hello Bob"),
  auth: aliceAuth,
});
```

### Group Messaging

**Who can create groups**:
- ✅ Any registered AID
- ✅ Creator becomes owner
- ❌ No admin-only group creation (future)

**Who can send to groups**:
- ✅ Group members only (verified in backend)
- ❌ Non-members get error: "Only group members can send messages"

**Who can manage groups**:
- Owner role:
  - ✅ Add/remove members
  - ✅ Cannot leave without transferring ownership
  - ✅ Last owner cannot be removed
- Admin role:
  - ✅ Add/remove non-owner members
  - ❌ **Not fully enforced** (role field exists, logic incomplete)
- Member role:
  - ✅ Send messages
  - ✅ Leave group
  - ❌ Cannot add/remove members

**Example**:
```typescript
// Alice creates group → becomes owner
await client.group.createGroup({
  name: "team-alpha",
  initialMembers: [bob.aid, carol.aid],
  auth: aliceAuth,
});

// Alice can add members (owner)
await client.group.addMembers({
  groupId,
  members: [dave.aid],
  auth: aliceAuth,
});

// Bob cannot add members (member role)
await client.group.addMembers({
  groupId,
  members: [eve.aid],
  auth: bobAuth,  // ❌ Error: Only admins or owners can add members
});
```

### Acknowledgments

**Who can ack**:
- ✅ Message recipient only
- ✅ Verified via challenge/response (forAid matches recipient)
- ✅ Session tokens can auto-ack (watch command)

## Future Permission Model

### Tiered Access (Planned)

**Admin tier**:
- Global system permissions
- Onboard new users
- Set rate limits
- View usage metrics

**Registered tier**:
- Send/receive direct messages
- Create groups (configurable limit)
- Rate limited (configurable)

**Onboarding tier**:
- Receive messages only
- Send to designated onboarders
- Limited message quota
- Require SAID-based proof for full registration

### ACLs (Planned)

**Per-AID controls**:
```typescript
{
  aid: alice.aid,
  allowlist: [bob.aid, carol.aid],  // Only these can message alice
  blocklist: [eve.aid],             // Blocked from messaging alice
  rateLimit: {
    maxPerHour: 100,
    maxPerDay: 1000,
  },
}
```

**Global controls**:
```typescript
{
  requireOnboardingProof: true,  // New AIDs need SAID proof
  defaultRateLimit: {
    maxPerHour: 50,
    maxPerDay: 500,
  },
  allowGroupCreation: true,      // Can users create groups?
  maxGroupsPerAid: 10,
}
```

### Rate Limiting (Planned)

**Per-AID limits**:
- Messages sent per hour/day
- Challenges issued per hour
- Groups created per day
- Members added per hour

**Enforcement points**:
- `sendMessage`: Check sender rate limit
- `issueChallenge`: Check challenge rate limit
- `createGroup`: Check group creation limit
- `addMembers`: Check member addition limit

**Response**: `429 Too Many Requests` with retry-after header.

## Current Enforcement (v0.1.0)

### ✅ What's Enforced

**Identity**:
- ✅ Must be registered (public key in `keyStates`)
- ✅ Must prove control (challenge/response)
- ✅ Cannot impersonate others (signature verification)

**Groups**:
- ✅ Only members can send to group
- ✅ Only owner/admin can add/remove members
- ✅ Last owner cannot leave/be removed
- ✅ Cannot remove non-existent members

**Messages**:
- ✅ Cannot ack others' messages (AID verification)
- ✅ Cannot reuse auth proofs (single-use challenges)
- ✅ Cannot modify args after signing (args hash)

### ❌ What's NOT Enforced

**Spam/DoS**:
- ❌ No rate limiting (anyone can flood)
- ❌ No message size limits
- ❌ No attachment restrictions

**Privacy**:
- ❌ Anyone can message anyone (no blocklists)
- ❌ No "request to message" flow
- ❌ No read receipts control

**Storage**:
- ❌ Messages never expire (accumulate forever)
- ❌ No per-user quota
- ❌ No group size limits

**Onboarding**:
- ❌ Anyone can register (no admin approval)
- ❌ No SAID-based onboarding proofs enforced
- ❌ No tier restrictions

## Data Model

### User Tiers (Schema Defined, Not Enforced)

```typescript
// convex/schema.ts (userTiers table exists)
{
  aid: string;
  tier: "admin" | "registered" | "onboarding";
  onboardingProof?: string;  // SAID of welcome message
  onboardedBy?: string;      // Admin AID who onboarded
  createdAt: number;
}
```

**v0.1.0 behavior**: Table exists, but mutations don't check it.

### Rate Limits (Schema Defined, Not Enforced)

```typescript
// convex/schema.ts (rateLimits table exists)
{
  aid: string;
  maxMessagesPerHour: number;
  maxMessagesPerDay: number;
  lastResetHour: number;
  lastResetDay: number;
  currentHourCount: number;
  currentDayCount: number;
}
```

**v0.1.0 behavior**: Table exists, but mutations don't increment counters.

### ACLs (Not Implemented)

No database tables for allowlists/blocklists yet.

## Admin Operations

### Current Admin Functions

**Identity registration** (`convex/identity.ts`):
```typescript
registerKeyState({
  aid,
  ksn,
  keys,
  threshold,
  lastEvtSaid,
})
```
- ✅ Anyone can call (no admin check)
- ✅ Caches public keys in `keyStates`
- ❌ No approval workflow

**Onboarding** (`convex/onboarding.ts`):
```typescript
onboardUser({
  userAid,
  onboardingProof,
  auth,  // Admin auth
})
```
- ✅ Function exists
- ❌ Not enforced (users can register without it)
- ❌ SAID verification stub (doesn't validate proof)

### Future Admin Dashboard

**Planned operations**:
- View all registered AIDs
- Set per-user rate limits
- Ban/unban users
- View usage metrics
- Approve onboarding requests
- Manage global settings

## Testing Permissions

**Direct messaging**:
```bash
# Alice sends to Bob (works)
merits send $BOB_AID --message "Hello" --from alice

# Bob receives (works)
merits receive --from bob
```

**Group messaging**:
```bash
# Alice creates group (works)
merits group create team --from alice

# Alice adds Bob (works - owner)
merits group add $GROUP_ID $BOB_AID --from alice

# Bob tries to add Carol (fails - not owner/admin)
merits group add $GROUP_ID $CAROL_AID --from bob
# Error: Only admins or owners can add members

# Bob sends to group (works - member)
merits send $GROUP_ID --message "Hello team" --from bob

# Carol tries to send (fails - not member)
merits send $GROUP_ID --message "Hello" --from carol
# Error: Only group members can send messages
```

**See**:
- [tests/integration/group-integration.test.ts](../tests/integration/group-integration.test.ts) - Group permission tests
- [tests/integration/messaging-flow.test.ts](../tests/integration/messaging-flow.test.ts) - Message delivery tests

## Implementation Files

**Backend**:
- [convex/messages.ts](../convex/messages.ts) - Message send/receive (no ACL checks yet)
- [convex/groups.ts](../convex/groups.ts) - Group role checks
- [convex/onboarding.ts](../convex/onboarding.ts) - Onboarding (not enforced)
- [convex/schema.ts](../convex/schema.ts) - Permission-related tables

**Future**:
- `convex/admin.ts` - Admin operations
- `convex/acls.ts` - ACL enforcement
- `convex/rateLimit.ts` - Rate limiting logic

## Migration Path

When ACLs/rate limiting are added:

1. **Phase 1**: Add enforcement without breaking existing users
   - Default to "open" mode (current behavior)
   - New users opt-in to ACLs
   - Rate limits very high (won't affect normal use)

2. **Phase 2**: Gradual tightening
   - Lower rate limits for new users
   - Require onboarding proofs for new registrations
   - Allowlist/blocklist opt-in

3. **Phase 3**: Full enforcement
   - All users subject to rate limits
   - Onboarding proofs required
   - Admin approval for new registrations (optional)

**Database migrations**: None needed (tables already exist, just unenforced).

## Security Considerations

### Current Risks (v0.1.0)

**Spam**:
- ❌ Anyone can flood any AID with messages
- ❌ No cost to create challenges
- ❌ No message size limits

**Storage**:
- ❌ Messages never expire
- ❌ Attackers can fill database
- ❌ No per-user quota

**Group spam**:
- ❌ Group creator can add unlimited members
- ❌ Members can send unlimited messages
- ❌ No group size limits

### Mitigation (v0.1.0)

**Convex limits** (external to Merits):
- Database size limits (Convex free tier: 1GB)
- Function execution limits
- Bandwidth limits

**Best practices** (recommended):
- Deploy on Convex Pro (higher limits)
- Monitor database size
- Manually ban abusive AIDs (delete from `keyStates`)
- Set Convex rate limits at infrastructure level

### Future Mitigation

See [docs/future-work.md](./future-work.md) for planned security improvements.

## References

- **[Authentication](./auth.md)** - How users prove identity
- **[Architecture](./architecture.md)** - Permission enforcement points
- **[Future Work](./future-work.md)** - Planned ACL/rate limiting features
