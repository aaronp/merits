# Setting Up Authorization Patterns for Testing

## Problem

By default, unknown users can only message onboarding admins. This makes E2E testing difficult because test identities (Alice, Bob) cannot message each other without going through the full onboarding flow.

## Solution: Authorization Patterns

Authorization patterns allow unknown users to message recipients whose AIDs match specific regex patterns.

## Setup for Development/Testing

### Option 1: Allow All (Development Only)

**⚠️ WARNING**: This bypasses authorization completely. Only use in local development.

1. Open Convex Dashboard: https://dashboard.convex.dev
2. Navigate to your project → Data → `authPatterns`
3. Click "Add Document"
4. Add:
   ```json
   {
     "pattern": ".*",
     "description": "DEV: Allow all messaging (DISABLE IN PRODUCTION)",
     "appliesTo": "unknown",
     "priority": 100,
     "active": true,
     "createdBy": "MANUAL",
     "createdAt": 1234567890000
   }
   ```
5. Save

Now any unknown user can message anyone.

### Option 2: Specific Test AIDs

For more controlled testing, add patterns for specific AIDs:

1. Run your test once to see the generated AIDs in logs/errors
2. Add pattern for those specific AIDs:
   ```json
   {
     "pattern": "^D[A-Za-z0-9_-]{43}$",
     "description": "Match specific test AID",
     "appliesTo": "unknown",
     "priority": 100,
     "active": true,
     "createdBy": "MANUAL",
     "createdAt": 1234567890000
   }
   ```

### Option 3: Bootstrap Mutation (Automated)

Use the `bootstrapTestPattern` mutation:

```typescript
import { ConvexClient } from "convex/browser";

const client = new ConvexClient(process.env.CONVEX_URL);
await client.mutation("authorization:bootstrapTestPattern", {});
client.close();
```

This creates a `^TEST` pattern, but **NOTE**: This pattern won't work because AIDs are derived from public keys (always start with "D"), not from identity names.

## Why TEST Prefix Doesn't Work

- **Identity names** (TESTAlice, TESTBob) are local vault labels
- **AIDs** (DzOY9bFUgdrOc...) are derived from Ed25519 public keys
- AIDs always start with `D` (CESR format for Ed25519)
- Pattern matching happens on AIDs, not identity names

**Example**:
```
Identity name: TESTAlice
AID: DzOY9bFUgdrOcP5BWFNbNMRLfuze2qPqk5YRKL3Y06P8
```

The pattern `^TEST` will never match the AID `D...`.

## Recommended Approach for E2E Tests

**For local development**: Use Option 1 (allow all with `.*` pattern)

**For CI/production testing**: Use the onboarding flow:
1. Create admin identity
2. Bootstrap admin role
3. Unknown users message admin
4. Admin onboards users
5. Now users can message each other

See [tests/integration/onboarding-flow.test.ts](../tests/integration/onboarding-flow.test.ts) for complete example.

## Cleanup

After testing, either:
1. **Deactivate pattern**: Set `active: false` in Dashboard
2. **Delete pattern**: Remove document from `authPatterns` table
3. **Use expiration**: Set `expiresAt` timestamp when creating pattern

## Security Notes

- ⚠️ **Never deploy `.* ` pattern to production**
- Patterns only apply to `unknown` tier (known/verified users have broad access anyway)
- All pattern operations are logged with `createdBy` audit trail
- Patterns are checked in priority order (higher number = checked first)
- Invalid regex patterns are silently skipped

## See Also

- [docs/permissions.md](./permissions.md) - Full authorization model documentation
- [convex/authorization.ts](../convex/authorization.ts) - Pattern matching implementation
- [tests/integration/onboarding-flow.test.ts](../tests/integration/onboarding-flow.test.ts) - Proper onboarding flow
