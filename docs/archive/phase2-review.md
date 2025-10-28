# CLI Phase 2 Review: Backend-Agnostic Identity Management

## Goal of This Review
Ensure Phase 2 of the Merits CLI (Identity Management) stays backend-agnostic and cleanly layered, instead of coupling the CLI directly to any specific backend implementation (Convex today, REST or anything else tomorrow).

This document summarizes:
1. What needs to change in Phase 2 to meet that goal
2. The new abstractions we should introduce
3. How Phase 2 commands should call into those abstractions

---

## 1. Desired Layering

### What we want
- The CLI should only depend on *interfaces* from `core/interfaces`:
  - `IdentityAuth` (auth challenges)
  - `Transport` (send/receive/ack)
  - `GroupApi` (group ops)
  - plus an identity registry abstraction

- The CLI should **not** import or know about Convex, Convex mutations, Convex URLs, etc.

- One adapter (e.g. `ConvexMeritsClient`) should translate those generic interfaces into concrete backend calls.

### Why this matters
- We can swap Convex for REST or local dev without touching CLI command code.
- Security logic (auth, rotation, registration) stays consistent and centralized.
- We don’t leak backend terms or data model into user-facing CLI UX.

---

## 2. Introduce a Stable `MeritsClient` Interface

We define one `MeritsClient` that the CLI talks to. It wraps all backend ops in a backend-agnostic way:

```ts
// src/client.ts (or client/index.ts)
import type { IdentityAuth } from "../core/interfaces/IdentityAuth";
import type { Transport } from "../core/interfaces/Transport";
import type { GroupApi } from "../core/interfaces/GroupApi";

export interface MeritsClient {
  identityAuth: IdentityAuth; // issueChallenge(), verifyAuth()
  transport: Transport;       // sendMessage(), receiveMessages(), ackMessage(), subscribe()
  group: GroupApi;            // createGroup(), sendGroupMessage(), etc.

  identityRegistry: {
    /**
     * Register a new identity + its initial keystate
     */
    registerIdentity(req: {
      aid: string;
      publicKey: Uint8Array; // or CESR string
      ksn: number;
    }): Promise<void>;

    /**
     * Rotate keys / advance KSN
     */
    rotateKeys(req: {
      aid: string;
      oldKsn: number;
      newKsn: number;
      newPublicKey: Uint8Array;
      rotationProofSigs: string[]; // indexed sigs from old key
    }): Promise<void>;
  };

  close(): void;
}
```

### Key idea
- The CLI *only* calls `MeritsClient`.
- The Convex-specific client (`createConvexMeritsClient`) implements that interface internally.
- A future REST client (`createRestMeritsClient`) can also implement it.

This isolates backend details from CLI commands.

---

## 3. Config Must Become Backend-Agnostic

### Current problem
`config.ts` stores `convexUrl`, and CLI flags/env vars refer to Convex directly.

That bakes Convex into the CLI surface.

### Fix
Change config to describe a backend *in general*, not Convex specifically:

```ts
export interface MeritsConfig {
  version: number;
  backend: {
    type: "convex" | "rest" | "local"; // etc.
    url: string; // Convex deployment URL, REST base URL, etc.
  };
  defaultIdentity?: string;
  outputFormat?: "json" | "text" | "compact";
  watchInterval?: number;
  verbose?: boolean;
  color?: boolean;
}
```

Then:

- `loadConfig()` builds `config.backend` (still reading `CONVEX_URL` etc. for compatibility, but mapping it into `backend`).
- `createMeritsClient(config)` switches on `config.backend.type`:
  - `"convex"` → `createConvexMeritsClient(config.backend.url)`
  - `"rest"` → `createRestMeritsClient(config.backend.url)`
- The CLI never sees `convexUrl` anymore.

This removes Convex assumptions from:
- CLI flags
- help text
- error messages like “convexUrl required”

---

## 4. Update CLI Context

### Before (Phase 1 draft)
```ts
const ctx = {
  config,
  vault,
  client: createMeritsClient(config.convexUrl),
};
```

### After
```ts
const ctx = {
  config,
  vault,
  client: createMeritsClient(config), // picks adapter based on config.backend.type
};
```

And the `CLIContext` type becomes:

```ts
export interface CLIContext {
  config: ResolvedConfig;
  vault: MeritsVault;
  client: MeritsClient;
}
```

Now every CLI command receives:
- `vault` for local key material
- `client` for server interaction
- zero Convex-specific knowledge

---

## 5. How Phase 2 Commands Should Call Into the Client

### 5.1 `merits init`
**Goal:** create first identity, register it, set default.

**Flow (backend-agnostic):**
1. Generate keypair
2. Store it in the vault
3. Call backend identityRegistry.registerIdentity()
4. Mark identity metadata as registered
5. Set as default in config

```ts
await ctx.vault.storeIdentity(name, {
  aid,
  privateKey: keys.privateKey,
  ksn: 0,
  metadata: {
    createdAt: Date.now(),
    description: "Primary identity",
    registered: false,
  }
});

await ctx.client.identityRegistry.registerIdentity({
  aid,
  publicKey: keys.publicKey,
  ksn: 0,
});

// Update metadata to reflect registration
await ctx.vault.updateMetadata(name, {
  registered: true,
  registeredAt: Date.now(),
});
```

No Convex APIs. No Convex mutation names. All through `identityRegistry`.

---

### 5.2 `merits identity new`
Similar story:
- Create/stash keys in vault
- Optionally register through `client.identityRegistry.registerIdentity()`
- Optionally set as default

The CLI never does a Convex mutation directly.

---

### 5.3 `merits identity register`
**Old approach:** `ctx.client.identity.register(...)`  
**New approach:** `ctx.client.identityRegistry.registerIdentity(...)`

Also: do **not** export the private key just to derive the public key. Either:
- store the public key in vault metadata at creation, OR
- add `vault.getPublicKey(name)`.

Then:

```ts
await ctx.client.identityRegistry.registerIdentity({
  aid: identity.aid,
  publicKey,
  ksn: identity.ksn,
});

await ctx.vault.updateMetadata(name, {
  registered: true,
  registeredAt: Date.now(),
});
```

Still backend-agnostic.

---

### 5.4 `merits identity rotate`
Key rotation should:
1. Generate new keypair
2. Create rotation event (oldKsn -> newKsn, new public key, timestamp, reason)
3. Sign that rotation event with the *old* key
   - IMPORTANT: use `vault.signIndexed(...)`, do **not** export the private key
4. Send rotation to backend via `client.identityRegistry.rotateKeys(...)`
5. Update vault with the new private key and incremented `ksn`

```ts
const rotationEvent = {
  aid: identity.aid,
  oldKsn,
  newKsn: oldKsn + 1,
  newPublicKey: newKeys.publicKey,
  reason: opts.reason ?? "manual-rotation",
  timestamp: Date.now(),
};

// Sign with current key WITHOUT exporting it
const sigs = await ctx.vault.signIndexed(
  name,
  new TextEncoder().encode(JSON.stringify(rotationEvent))
);

// Tell backend to accept new key state
await ctx.client.identityRegistry.rotateKeys({
  aid: identity.aid,
  oldKsn,
  newKsn: oldKsn + 1,
  newPublicKey: newKeys.publicKey,
  rotationProofSigs: sigs,
});

// Update vault locally to use the new private key + incremented KSN
await ctx.vault.storeIdentity(name, {
  aid: identity.aid,
  privateKey: newKeys.privateKey,
  ksn: oldKsn + 1,
  metadata: {
    ...identity.metadata,
    rotatedAt: Date.now(),
    rotationReason: opts.reason ?? "manual-rotation",
  },
});
```

Highlights:
- We never leak the private key
- We never call a Convex mutation by name
- We only talk to the abstract `identityRegistry.rotateKeys`

---

## 6. Auth Flow in Phase 2+

Your helper `getAuthProof(...)` should be refactored to use `IdentityAuth` instead of something Convex-ish like `client.identity.issueChallenge(...)`.

```ts
const challenge = await client.identityAuth.issueChallenge({
  aid,
  purpose, // "send" | "receive" | "ack" | etc (from IdentityAuth.Purpose)
  args,
});

const encoded = canonicalize(challenge.payloadToSign);
const sigs = await vault.signIndexed(identityName, encoded);

return {
  challengeId: challenge.challengeId,
  sigs,
  ksn,
};
```

Then in Phase 3:
- `send` will call `client.transport.sendMessage({ ..., auth })`
- `receive` will call `client.transport.receiveMessages({ for: aid, auth })`
- `ack` will call `client.transport.ackMessage({ messageId, auth, ... })`

Again: pure interfaces (`Transport`), no Convex leaking into CLI.

---

## 7. Vault Improvements Needed in Phase 2

To support the flows above without breaking the “keys never leave vault” rule, the vault needs a couple more helpers:

1. `vault.updateMetadata(name, patch)`  
   - Patch metadata for an identity without re-importing the private key.
   - Used for: `registered: true`, rotation timestamps, descriptions, etc.

2. `vault.getPublicKey(name)` **or** “store publicKey in metadata at creation time”  
   - We shouldn't export the private key just to recompute the public key for registration.
   - Save the public key at creation so it's always available safely.

If we add those, then every dangerous thing in Phase 2 (registration, rotation) can be done without ever exposing secrets to the caller.

---

## 8. Naming / UX Cleanup

- Anywhere the CLI says "convex" (like `--convex-url`), change it to backend-neutral naming:
  - `--backend-url`
  - `--backend-type <convex|rest|...>`
  - config error messages like:  
    "backend.url is required (set via --backend-url or env var)"

- Help text and README should describe "Merits backend" not "Convex deployment".

That will make docs and CLI feel portable and not vendor-bound.

---

## 9. TL;DR Action Items

**Config & boot**
- [ ] Change config from `convexUrl` → `{ backend: { type, url } }`.
- [ ] Update `loadConfig` to still accept `CONVEX_URL` but map it into this new shape.
- [ ] Update CLI startup to call `createMeritsClient(config)` instead of `createMeritsClient(config.convexUrl)`.

**MeritsClient abstraction**
- [ ] Define `MeritsClient` interface with:
  - `identityAuth`
  - `transport`
  - `group`
  - `identityRegistry`
  - `close()`
- [ ] Implement `createConvexMeritsClient(config.backend.url)` that returns a `MeritsClient`.
- [ ] (Future) add other backends without touching CLI code.

**CLI command code**
- [ ] `init`, `identity new`, `identity register`, `identity rotate` must call:
  - `ctx.vault` for all key ops
  - `ctx.client.identityRegistry` for register / rotate
  - `ctx.client.identityAuth` in `getAuthProof`
- [ ] Remove any direct Convex naming or Convex mutation calls.
- [ ] Never export private keys except for explicit backup (`identity export --include-key`).

**Vault enhancements**
- [ ] Add `vault.updateMetadata(name, patch)`.
- [ ] Persist publicKey in metadata at creation so we don't need to derive it later by exporting the private key.

**Docs/UX**
- [ ] Update CLI help/README to say "Merits backend" instead of "Convex".
- [ ] Make `--convex-url` → `--backend-url` (still accept `--convex-url` as deprecated alias if you want migration comfort).

---

## Final Outcome

After these adjustments:

- Phase 2 delivers full identity lifecycle (create, register, list, export/import, delete, set-default, rotate) **without binding the CLI to Convex**.
- Phase 3 (messaging: send/receive/ack/watch) will automatically inherit the same backend-agnostic design, because commands will call `client.transport` and `getAuthProof()` — both of which are already specified by the interfaces in `core/interfaces`.

In other words: do this now in Phase 2 and you never have to “un-Convex” the CLI later.
