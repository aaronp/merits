# Test-Driven Migration Plan: Current → Roadmap Architecture

## Current State Assessment

### ✅ What's Working
- **Auth system**: KERI-based challenge/response with indexed signatures
  - `auth.ts`: `issueChallenge`, `verifyAuth`, KeyState management
  - Ed25519 signature verification via Web Crypto API
  - Challenge replay prevention
- **Message transport**: Send/receive/acknowledge with authentication
  - `messages.ts`: `send`, `receive`, `acknowledge`, `list`
  - Content hash binding, envelope hashing for audit trails
  - TTL enforcement, expiry cleanup
- **Authorization & tiers**: Onboarding flow with admin roles
  - `authorization.ts`: 3-tier system (unknown/known/verified)
  - Onboarding admin whitelist, rate limiting per tier
  - Server-side enforcement in `canSend`
- **Client SDK**: `MessageBusClient` with auth helpers
  - `src/client.ts`: Convenient wrappers, signature generation
- **Integration tests**: 9 test files covering auth, messaging, onboarding
  - Tests use real Convex deployment
  - Deterministic crypto via `tests/crypto-utils.ts`

### 🔄 Current Dependencies
- `convex`: Backend framework
- `libsodium-wrappers-sumo`: Crypto (currently used in tests)
- `cesr-ts`: KERI CESR encoding (partial usage)
- Bun runtime for tests

### 📊 Schema Status
Currently uses Convex validators (`v.*`), not TypeBox. Tables:
- `messages`, `challenges`, `keyStates`
- `onboardingAdmins`, `adminRoles`, `userTiers`, `rateLimits`

---

## Migration Strategy: Incremental Evolution

We'll evolve in place, extracting interfaces and schemas progressively without a hard package split initially.

### Phase 1: Extract Core Types & Interfaces (in-repo)
**Goal**: Define portable contracts within the current monorepo, Convex code implements them

**Structure**:
```
merits/
├── core/                    # NEW: portable core
│   ├── types.ts            # AID, KeyState, AuthProof
│   ├── schemas/            # TypeBox schemas (future)
│   ├── interfaces/
│   │   ├── IdentityAuth.ts
│   │   ├── Transport.ts
│   │   └── GroupApi.ts
│   └── runtime/
│       └── router.ts       # MessageRouter implementation
├── convex/                  # Convex backend (implements core interfaces)
│   ├── auth.ts             # ConvexIdentityAuth
│   ├── messages.ts         # ConvexTransport
│   ├── authorization.ts    # stays internal to Convex
│   └── groups.ts           # NEW: ConvexGroupApi
├── src/
│   └── client.ts           # Client SDK (uses core interfaces)
├── tests/
│   ├── unit/               # NEW: pure core logic tests
│   └── integration/        # Convex integration tests
└── Makefile                # Orchestrates all test targets
```

### Phase 2: Implement & Test Incrementally
**Principle**: Write tests first, migrate code to satisfy them

### Phase 3: Add Groups & Subscribe
**New features** guided by roadmap, built on refactored foundation

---

## Milestone Breakdown with TDD Flow

### Milestone 0: Baseline & Test Infrastructure
**Goal**: Organize current tests, add missing coverage, establish test-running conventions

#### Tasks
1. **Reorganize test structure**
   ```
   tests/
   ├── unit/                          # Pure logic, no Convex
   │   ├── crypto.test.ts             # Move existing
   │   ├── signature.test.ts          # Consolidate signature-debug
   │   └── envelope-hash.test.ts      # Extract from integration
   ├── integration/
   │   ├── auth.test.ts               # auth-integration
   │   ├── messaging.test.ts          # messaging-flow, end-to-end-simple
   │   ├── onboarding.test.ts         # onboarding-flow
   │   └── full-flow.test.ts          # Current integration.test.ts
   └── helpers/
       ├── crypto-utils.ts            # Shared test crypto
       ├── convex-setup.ts            # Shared Convex bootstrap
       └── deterministic-clock.ts     # NEW: Clock injection for TTL tests
   ```

2. **Add Makefile test targets**
   ```makefile
   test: test-unit test-integration

   test-unit:
       bun test tests/unit/**/*.test.ts

   test-integration:
       @if [ ! -f .env.local ]; then echo "Run 'make dev' first"; exit 1; fi
       @export $$(grep -v '^#' .env.local | xargs) && bun test tests/integration/**/*.test.ts

   test-watch:
       bun test --watch

   test-coverage:
       bun test --coverage
   ```

3. **Add missing test coverage**
   - **Rate limiting**: Test unknown/known/verified tier limits
   - **Key rotation**: Test message receipt with old vs new KSN
   - **Challenge expiry**: Test expired challenge rejection
   - **Message expiry**: Test TTL boundary conditions
   - **Admin operations**: Full RBAC flow (grant/revoke roles)

**Acceptance Criteria**:
- [ ] `make test-unit` runs fast (<1s), no Convex dependency
- [ ] `make test-integration` covers all auth/messaging/admin flows
- [ ] Test coverage >80% on convex/*.ts

---

### Milestone 1: Extract Core Interfaces (Backend-Agnostic Contracts)

**TDD Approach**: Write interface tests, then extract implementation

#### Step 1.1: Define `core/types.ts`
**Test first**:
```ts
// tests/unit/types.test.ts
import { describe, test, expect } from "bun:test";
import { isValidAID, isIndexedSig } from "../core/types";

describe("Core Types", () => {
  test("validates AID format", () => {
    expect(isValidAID("Eabc123...")).toBe(true);
    expect(isValidAID("invalid")).toBe(false);
  });

  test("validates IndexedSig format", () => {
    expect(isIndexedSig("0-Alx5JH2kKci...")).toBe(true);
    expect(isIndexedSig("invalid")).toBe(false);
  });
});
```

**Implementation**:
```ts
// core/types.ts
export type AID = string; // Branded type in future
export type IndexedSig = string; // Format: "idx-base64url"

export interface AuthProof {
  challengeId: string;
  sigs: IndexedSig[];
  ksn: number;
}

export interface KeyState {
  aid: AID;
  ksn: number;
  keys: string[]; // CESR-encoded public keys
  threshold: string;
  lastEvtSaid: string;
}

export function isValidAID(s: string): boolean {
  return /^[A-Z][A-Za-z0-9_-]{7,}$/.test(s);
}

export function isIndexedSig(s: string): boolean {
  return /^\d+-[A-Za-z0-9_-]+$/.test(s);
}
```

#### Step 1.2: Define `core/interfaces/IdentityAuth.ts`
**Test first**:
```ts
// tests/integration/identity-auth-interface.test.ts
import { describe, test, expect, beforeAll } from "bun:test";
import { ConvexIdentityAuth } from "../../convex/auth-adapter"; // NEW
import { IdentityAuth } from "../../core/interfaces/IdentityAuth";
import { setupConvexTest } from "../helpers/convex-setup";

describe("IdentityAuth Interface (Convex impl)", () => {
  let auth: IdentityAuth;
  let cleanup: () => void;

  beforeAll(async () => {
    const ctx = await setupConvexTest();
    auth = new ConvexIdentityAuth(ctx.convex);
    cleanup = ctx.cleanup;
  });

  test("issueChallenge returns well-formed payload", async () => {
    const result = await auth.issueChallenge({
      aid: "Ealice...",
      purpose: "send",
      args: { to: "Ebob...", ctHash: "sha256:abc" },
    });

    expect(result.challengeId).toBeTruthy();
    expect(result.payloadToSign.ver).toBe("msg-auth/1");
    expect(result.payloadToSign.aid).toBe("Ealice...");
    expect(result.payloadToSign.nonce).toBeTruthy();
  });

  test("verifyAuth rejects tampered args", async () => {
    const challenge = await auth.issueChallenge({
      aid: "Ealice...",
      purpose: "send",
      args: { to: "Ebob...", ctHash: "sha256:abc" },
    });

    const sigs = signPayload(challenge.payloadToSign, alicePrivKey);

    await expect(
      auth.verifyAuth({
        proof: { challengeId: challenge.challengeId, sigs, ksn: 0 },
        expectedPurpose: "send",
        args: { to: "Ebob...", ctHash: "TAMPERED" }, // Different!
      })
    ).rejects.toThrow("Args hash mismatch");
  });
});
```

**Implementation**:
```ts
// core/interfaces/IdentityAuth.ts
import { AID, AuthProof } from "../types";

export type Purpose = "send" | "receive" | "ack" | "admin" | "sendGroup" | "manageGroup";

export interface IssueChallengeRequest {
  aid: AID;
  purpose: Purpose;
  args: Record<string, unknown>;
  ttlMs?: number;
}

export interface IssueChallengeResponse {
  challengeId: string;
  payloadToSign: {
    ver: "msg-auth/1";
    aud: string;
    ts: number;
    nonce: string;
    aid: AID;
    purpose: Purpose;
    argsHash: string;
  };
}

export interface VerifyAuthRequest {
  proof: AuthProof;
  expectedPurpose: Purpose;
  args: Record<string, unknown>;
}

export interface VerifyAuthResult {
  aid: AID;
  ksn: number;
  evtSaid: string;
}

export interface IdentityAuth {
  issueChallenge(req: IssueChallengeRequest): Promise<IssueChallengeResponse>;
  verifyAuth(req: VerifyAuthRequest): Promise<VerifyAuthResult>;
}
```

```ts
// convex/auth-adapter.ts (NEW)
import { ConvexClient } from "convex/browser";
import { api } from "./_generated/api";
import { IdentityAuth, IssueChallengeRequest, VerifyAuthRequest } from "../core/interfaces/IdentityAuth";

export class ConvexIdentityAuth implements IdentityAuth {
  constructor(private client: ConvexClient) {}

  async issueChallenge(req: IssueChallengeRequest) {
    // Compute argsHash
    const argsHash = await this.client.query(api.auth.computeHash, { args: req.args });

    // Issue challenge
    const result = await this.client.mutation(api.auth.issueChallenge, {
      aid: req.aid,
      purpose: req.purpose,
      argsHash,
      ttl: req.ttlMs,
    });

    return {
      challengeId: result.challengeId,
      payloadToSign: result.payload,
    };
  }

  async verifyAuth(req: VerifyAuthRequest) {
    // This is server-side only, called within mutations
    throw new Error("verifyAuth is server-side only");
  }
}
```

#### Step 1.3: Define `core/interfaces/Transport.ts`
**Test first**:
```ts
// tests/integration/transport-interface.test.ts
import { describe, test, expect } from "bun:test";
import { ConvexTransport } from "../../convex/messages-adapter";
import { Transport } from "../../core/interfaces/Transport";

describe("Transport Interface (Convex impl)", () => {
  let transport: Transport;

  // ... setup ...

  test("sendMessage returns messageId", async () => {
    const result = await transport.sendMessage({
      to: "Ebob...",
      ct: "encrypted-blob",
      typ: "chat.text.v1",
      ttlMs: 60000,
      auth: aliceAuthProof,
    });

    expect(result.messageId).toBeTruthy();
  });

  test("receiveMessages filters by recipient", async () => {
    // Alice sends to Bob
    await transport.sendMessage({ to: "Ebob...", ct: "msg1", auth: aliceAuth });

    // Bob receives
    const msgs = await transport.receiveMessages({ for: "Ebob...", auth: bobAuth });

    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs[0].to).toBe("Ebob...");
    expect(msgs[0].from).toBe("Ealice...");
  });

  test("subscribe streams messages with auto-ack", async () => {
    const received: any[] = [];

    const cancel = await transport.subscribe({
      for: "Ebob...",
      auth: bobAuth,
      onMessage: async (msg) => {
        received.push(msg);
        return true; // ack
      },
    });

    // Alice sends
    await transport.sendMessage({ to: "Ebob...", ct: "live-msg", auth: aliceAuth });

    await sleep(200); // Wait for push

    expect(received.length).toBe(1);
    expect(received[0].ct).toBe("live-msg");

    cancel();
  });
});
```

**Implementation**:
```ts
// core/interfaces/Transport.ts
import { AID, AuthProof } from "../types";

export interface MessageSendRequest {
  to: AID;
  ct: string; // Ciphertext
  typ?: string; // Message type for routing
  ek?: string; // Ephemeral key (PFS)
  alg?: string; // Algorithm
  ttlMs?: number;
  auth: AuthProof;
}

export interface EncryptedMessage {
  id: string;
  from: AID;
  to: AID;
  ct: string;
  ek?: string;
  alg?: string;
  typ?: string;
  createdAt: number;
  expiresAt: number;
  envelopeHash: string;
  senderProof: {
    sigs: string[];
    ksn: number;
    evtSaid: string;
  };
}

export interface SubscribeOptions {
  for: AID;
  auth: AuthProof;
  onMessage: (msg: EncryptedMessage) => Promise<boolean>; // Return true to ack
  onError?: (err: Error) => void;
}

export interface Transport {
  sendMessage(req: MessageSendRequest): Promise<{ messageId: string }>;

  receiveMessages(req: { for: AID; auth: AuthProof }): Promise<EncryptedMessage[]>;

  ackMessage(req: {
    messageId: string;
    auth: AuthProof;
    receiptSig?: string[];
  }): Promise<void>;

  subscribe(opts: SubscribeOptions): Promise<() => void>; // Returns cancel function
}
```

```ts
// convex/messages-adapter.ts (NEW)
import { ConvexClient } from "convex/browser";
import { api } from "./_generated/api";
import { Transport, MessageSendRequest, EncryptedMessage } from "../core/interfaces/Transport";

export class ConvexTransport implements Transport {
  constructor(private client: ConvexClient) {}

  async sendMessage(req: MessageSendRequest) {
    // Compute ctHash
    const ctHash = await this.computeCtHash(req.ct);

    const messageId = await this.client.mutation(api.messages.send, {
      recpAid: req.to,
      ct: req.ct,
      typ: req.typ,
      ek: req.ek,
      alg: req.alg,
      ttl: req.ttlMs,
      auth: {
        challengeId: req.auth.challengeId,
        sigs: req.auth.sigs,
        ksn: req.auth.ksn,
      },
    });

    return { messageId };
  }

  async receiveMessages(req: { for: string; auth: AuthProof }) {
    const messages = await this.client.mutation(api.messages.receive, {
      recpAid: req.for,
      auth: {
        challengeId: req.auth.challengeId,
        sigs: req.auth.sigs,
        ksn: req.auth.ksn,
      },
    });

    return messages.map((m: any) => ({
      id: m.id,
      from: m.senderAid,
      to: req.for,
      ct: m.ct,
      ek: m.ek,
      alg: m.alg,
      typ: m.typ,
      createdAt: m.createdAt,
      expiresAt: m.expiresAt,
      envelopeHash: m.envelopeHash,
      senderProof: {
        sigs: m.senderSig,
        ksn: m.senderKsn,
        evtSaid: m.senderEvtSaid,
      },
    }));
  }

  async ackMessage(req: { messageId: string; auth: AuthProof; receiptSig?: string[] }) {
    await this.client.mutation(api.messages.acknowledge, {
      messageId: req.messageId,
      receipt: req.receiptSig ?? [],
      auth: {
        challengeId: req.auth.challengeId,
        sigs: req.auth.sigs,
        ksn: req.auth.ksn,
      },
    });
  }

  async subscribe(opts: SubscribeOptions) {
    // Use Convex's messages.list query with watch
    const unsubscribe = this.client.onUpdate(
      api.messages.list,
      { recpAid: opts.for },
      async (messages: any[]) => {
        for (const msg of messages) {
          try {
            const encryptedMsg: EncryptedMessage = {
              id: msg.id,
              from: msg.senderAid,
              to: opts.for,
              ct: msg.ct,
              ek: msg.ek,
              alg: msg.alg,
              typ: msg.typ,
              createdAt: msg.createdAt,
              expiresAt: msg.expiresAt,
              envelopeHash: msg.envelopeHash,
              senderProof: {
                sigs: msg.senderSig,
                ksn: msg.senderKsn,
                evtSaid: msg.senderEvtSaid,
              },
            };

            const shouldAck = await opts.onMessage(encryptedMsg);

            if (shouldAck) {
              await this.ackMessage({ messageId: msg.id, auth: opts.auth });
            }
          } catch (err) {
            opts.onError?.(err as Error);
          }
        }
      }
    );

    return () => unsubscribe();
  }

  private async computeCtHash(ct: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(ct);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }
}
```

**Acceptance Criteria (Milestone 1)**:
- [ ] `core/types.ts` with AID, AuthProof, KeyState
- [ ] `core/interfaces/IdentityAuth.ts` with interface + tests
- [ ] `core/interfaces/Transport.ts` with interface + tests
- [ ] `convex/auth-adapter.ts` implements IdentityAuth
- [ ] `convex/messages-adapter.ts` implements Transport (including subscribe)
- [ ] All existing integration tests still pass
- [ ] New interface tests pass with Convex backend

---

### Milestone 2: Message Router & Type Safety

**Goal**: Add pluggable message routing for apps

#### Step 2.1: Implement MessageRouter
**Test first**:
```ts
// tests/unit/router.test.ts
import { describe, test, expect } from "bun:test";
import { createMessageRouter } from "../../core/runtime/router";

describe("MessageRouter", () => {
  test("dispatches to registered handler by typ", async () => {
    const router = createMessageRouter();
    const handled: any[] = [];

    router.register("chat.text.v1", (msg, plaintext) => {
      handled.push({ msg, plaintext });
    });

    const mockMsg = {
      id: "msg1",
      from: "Ealice",
      to: "Ebob",
      ct: "encrypted",
      typ: "chat.text.v1",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60000,
      envelopeHash: "hash",
      senderProof: { sigs: [], ksn: 0, evtSaid: "evt" },
    };

    const mockCtx = {
      decrypt: async (m: any) => ({ text: "hello" }),
    };

    await router.dispatch(mockCtx, mockMsg);

    expect(handled.length).toBe(1);
    expect(handled[0].plaintext.text).toBe("hello");
  });

  test("ignores messages with no handler", async () => {
    const router = createMessageRouter();
    const mockMsg = { typ: "unknown.type", /* ... */ };
    const mockCtx = { decrypt: async () => ({}) };

    // Should not throw
    await router.dispatch(mockCtx, mockMsg);
  });
});
```

**Implementation**:
```ts
// core/runtime/router.ts
import { EncryptedMessage } from "../interfaces/Transport";

export interface MessageHandlerContext {
  decrypt: (m: EncryptedMessage) => Promise<unknown>;
}

export type MessageHandler = (
  msg: EncryptedMessage,
  plaintext: unknown
) => Promise<void> | void;

export interface MessageRouter {
  register(typ: string, handler: MessageHandler): void;
  dispatch(ctx: MessageHandlerContext, msg: EncryptedMessage): Promise<void>;
}

export function createMessageRouter(): MessageRouter {
  const handlers = new Map<string, MessageHandler>();

  return {
    register(typ, handler) {
      handlers.set(typ, handler);
    },

    async dispatch(ctx, msg) {
      const plaintext = await ctx.decrypt(msg);
      const typ = msg.typ ?? "unknown";
      const handler = handlers.get(typ);

      if (!handler) {
        // Optional: log unhandled message types
        return;
      }

      return handler(msg, plaintext);
    },
  };
}
```

#### Step 2.2: Integration test with router
```ts
// tests/integration/router-integration.test.ts
import { describe, test, expect } from "bun:test";
import { ConvexTransport } from "../../convex/messages-adapter";
import { createMessageRouter } from "../../core/runtime/router";

describe("Router Integration", () => {
  test("end-to-end: send, receive, route, ack", async () => {
    const transport = new ConvexTransport(convex);
    const router = createMessageRouter();
    const chatMessages: string[] = [];

    router.register("chat.text.v1", (msg, plaintext: any) => {
      chatMessages.push(plaintext.text);
    });

    // Alice sends
    await transport.sendMessage({
      to: "Ebob",
      ct: mockEncrypt({ text: "Hello Bob!" }),
      typ: "chat.text.v1",
      auth: aliceAuth,
    });

    // Bob receives
    const messages = await transport.receiveMessages({ for: "Ebob", auth: bobAuth });

    for (const msg of messages) {
      await router.dispatch({ decrypt: mockDecrypt }, msg);
      await transport.ackMessage({ messageId: msg.id, auth: bobAuth });
    }

    expect(chatMessages).toContain("Hello Bob!");
  });
});
```

**Acceptance Criteria (Milestone 2)**:
- [ ] `createMessageRouter()` with register/dispatch
- [ ] Unit tests for router logic
- [ ] Integration test showing send → receive → route → ack flow
- [ ] Documentation on how apps register custom message types

---

### Milestone 3: Groups & Server-Side Fanout

**Goal**: Implement group messaging with server-side fanout (plaintext option)

#### Step 3.1: Add Convex group schema
**Update `convex/schema.ts`**:
```ts
groups: defineTable({
  groupId: v.string(),
  members: v.array(v.string()), // AIDs
  policy: v.optional(v.object({
    kind: v.string(),
    quorum: v.optional(v.number()),
    admins: v.optional(v.array(v.string())),
  })),
  createdAt: v.number(),
  createdBy: v.string(), // AID
}).index("by_groupId", ["groupId"]),

groupLog: defineTable({
  groupId: v.string(),
  seq: v.number(), // Monotonic sequence
  envelopeHash: v.string(),
  senderAid: v.string(),
  createdAt: v.number(),
}).index("by_group_seq", ["groupId", "seq"]),
```

#### Step 3.2: Define GroupApi interface
**Test first**:
```ts
// tests/integration/group-api-interface.test.ts
import { describe, test, expect } from "bun:test";
import { ConvexGroupApi } from "../../convex/groups-adapter";

describe("GroupApi Interface (Convex impl)", () => {
  let groupApi: GroupApi;

  test("upsertGroup creates group with members", async () => {
    const group = await groupApi.upsertGroup({
      groupId: "grp:test",
      members: ["Ealice", "Ebob", "Ecarol"],
      policy: { kind: "broadcast" },
      auth: aliceAuth,
    });

    expect(group.groupId).toBe("grp:test");
    expect(group.members).toContain("Ealice");
    expect(group.members).toContain("Ebob");
  });

  test("sendGroupMessage fans out to all members", async () => {
    await groupApi.upsertGroup({
      groupId: "grp:team",
      members: ["Ealice", "Ebob"],
      auth: aliceAuth,
    });

    const result = await groupApi.sendGroupMessage({
      groupId: "grp:team",
      plaintext: "Hello team",
      typ: "chat.text.v1",
      auth: aliceAuth,
    });

    expect(result.deliveries.length).toBe(2);
    expect(result.deliveries.map(d => d.to)).toContain("Ealice");
    expect(result.deliveries.map(d => d.to)).toContain("Ebob");

    // Bob receives the message
    const bobMsgs = await transport.receiveMessages({ for: "Ebob", auth: bobAuth });
    const teamMsg = bobMsgs.find(m => m.typ === "chat.text.v1");
    expect(teamMsg).toBeTruthy();
    expect(teamMsg!.from).toBe("Ealice");
  });
});
```

**Implementation**:
```ts
// core/interfaces/GroupApi.ts
import { AID, AuthProof } from "../types";

export interface GroupPolicy {
  kind: "broadcast" | "raft" | "restricted";
  quorum?: number;
  admins?: AID[];
}

export interface GroupState {
  groupId: string;
  members: AID[];
  policy?: GroupPolicy;
  createdAt: number;
  createdBy: AID;
}

export interface GroupSendRequest {
  groupId: string;
  plaintext?: string; // Server-side fanout (preferred)
  perRecipient?: Record<AID, { ct: string; ek?: string; alg?: string }>; // Client-side fanout
  typ?: string;
  ttlMs?: number;
  auth: AuthProof;
}

export interface GroupApi {
  upsertGroup(req: {
    groupId: string;
    members: AID[];
    policy?: GroupPolicy;
    auth: AuthProof;
  }): Promise<GroupState>;

  getGroup(req: {
    groupId: string;
    auth: AuthProof;
  }): Promise<GroupState>;

  sendGroupMessage(req: GroupSendRequest): Promise<{
    deliveries: Array<{ to: AID; messageId: string }>;
  }>;
}
```

```ts
// convex/groups.ts (NEW)
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { verifyAuth } from "./auth";

export const upsertGroup = mutation({
  args: {
    groupId: v.string(),
    members: v.array(v.string()),
    policy: v.optional(v.object({
      kind: v.string(),
      quorum: v.optional(v.number()),
      admins: v.optional(v.array(v.string())),
    })),
    auth: v.object({
      challengeId: v.id("challenges"),
      sigs: v.array(v.string()),
      ksn: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const verified = await verifyAuth(ctx, args.auth, "manageGroup", {
      action: "upsertGroup",
      groupId: args.groupId,
      members: args.members,
    });

    const now = Date.now();

    const existing = await ctx.db
      .query("groups")
      .withIndex("by_groupId", q => q.eq("groupId", args.groupId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        members: args.members,
        policy: args.policy,
      });
      return existing;
    }

    const groupId = await ctx.db.insert("groups", {
      groupId: args.groupId,
      members: args.members,
      policy: args.policy,
      createdAt: now,
      createdBy: verified.aid,
    });

    return await ctx.db.get(groupId);
  },
});

export const sendGroupMessage = mutation({
  args: {
    groupId: v.string(),
    plaintext: v.optional(v.string()),
    typ: v.optional(v.string()),
    ttl: v.optional(v.number()),
    auth: v.object({
      challengeId: v.id("challenges"),
      sigs: v.array(v.string()),
      ksn: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const verified = await verifyAuth(ctx, args.auth, "sendGroup", {
      action: "sendGroupMessage",
      groupId: args.groupId,
    });

    // Get group
    const group = await ctx.db
      .query("groups")
      .withIndex("by_groupId", q => q.eq("groupId", args.groupId))
      .first();

    if (!group) {
      throw new Error("Group not found");
    }

    // Check sender is member
    if (!group.members.includes(verified.aid)) {
      throw new Error("Only group members can send");
    }

    const deliveries: Array<{ to: string; messageId: string }> = [];

    // Server-side fanout: encrypt plaintext for each member
    // (In production, use proper envelope encryption or hybrid crypto)
    // For now, we'll just send the same "ciphertext" to all (simulated)
    const ct = args.plaintext ?? ""; // Mock encryption

    for (const memberAid of group.members) {
      // Use internal sendMessage (bypass client auth for server-initiated sends)
      // We'll need to refactor messages.send to accept internal calls
      // For now, simulate by directly inserting messages

      const now = Date.now();
      const ttl = args.ttl ?? 24 * 60 * 60 * 1000;
      const expiresAt = now + ttl;

      const ctHash = await computeCtHash(ct);
      const envelopeHash = await computeEnvelopeHash(
        memberAid,
        verified.aid,
        ctHash,
        undefined,
        undefined,
        now,
        expiresAt
      );

      const messageId = await ctx.db.insert("messages", {
        recpAid: memberAid,
        senderAid: verified.aid,
        ct,
        ctHash,
        createdAt: now,
        expiresAt,
        retrieved: false,
        senderSig: args.auth.sigs,
        senderKsn: verified.ksn,
        senderEvtSaid: verified.evtSaid,
        envelopeHash,
        usedChallengeId: args.auth.challengeId,
      });

      deliveries.push({ to: memberAid, messageId });
    }

    // Append to group log
    const lastLog = await ctx.db
      .query("groupLog")
      .withIndex("by_group_seq", q => q.eq("groupId", args.groupId))
      .order("desc")
      .first();

    const nextSeq = (lastLog?.seq ?? 0) + 1;

    await ctx.db.insert("groupLog", {
      groupId: args.groupId,
      seq: nextSeq,
      envelopeHash: deliveries[0]?.envelopeHash ?? "", // Use first delivery's hash as group anchor
      senderAid: verified.aid,
      createdAt: Date.now(),
    });

    return { deliveries };
  },
});

// Helper imports (from auth.ts)
import { computeCtHash, computeEnvelopeHash } from "./auth";
```

```ts
// convex/groups-adapter.ts (NEW)
import { ConvexClient } from "convex/browser";
import { api } from "./_generated/api";
import { GroupApi, GroupSendRequest, GroupState } from "../core/interfaces/GroupApi";
import { AuthProof } from "../core/types";

export class ConvexGroupApi implements GroupApi {
  constructor(private client: ConvexClient) {}

  async upsertGroup(req: {
    groupId: string;
    members: string[];
    policy?: any;
    auth: AuthProof;
  }): Promise<GroupState> {
    return await this.client.mutation(api.groups.upsertGroup, {
      groupId: req.groupId,
      members: req.members,
      policy: req.policy,
      auth: {
        challengeId: req.auth.challengeId,
        sigs: req.auth.sigs,
        ksn: req.auth.ksn,
      },
    });
  }

  async getGroup(req: { groupId: string; auth: AuthProof }): Promise<GroupState> {
    // TODO: implement query
    throw new Error("Not implemented");
  }

  async sendGroupMessage(req: GroupSendRequest) {
    return await this.client.mutation(api.groups.sendGroupMessage, {
      groupId: req.groupId,
      plaintext: req.plaintext,
      typ: req.typ,
      ttl: req.ttlMs,
      auth: {
        challengeId: req.auth.challengeId,
        sigs: req.auth.sigs,
        ksn: req.auth.ksn,
      },
    });
  }
}
```

**Acceptance Criteria (Milestone 3)**:
- [ ] `convex/groups.ts` with upsertGroup, sendGroupMessage
- [ ] `ConvexGroupApi` adapter implements GroupApi interface
- [ ] Server-side plaintext fanout works (encrypts once per member)
- [ ] Group log records sequence and envelopeHash
- [ ] Integration test: create group, send message, all members receive
- [ ] Router integration: group messages dispatch to correct handlers

---

### Milestone 4: Crypto Helpers with @noble/ed25519

**Goal**: Replace libsodium with @noble/ed25519, clean crypto interfaces

#### Step 4.1: Add @noble/ed25519 dependency
```bash
bun add @noble/ed25519
bun remove libsodium-wrappers-sumo
```

#### Step 4.2: Create crypto module
**Test first**:
```ts
// tests/unit/crypto.test.ts
import { describe, test, expect } from "bun:test";
import { generateKeyPair, sign, verify, createAID } from "../../core/crypto";

describe("Crypto Helpers (@noble/ed25519)", () => {
  test("generateKeyPair produces valid Ed25519 keys", async () => {
    const keys = await generateKeyPair();
    expect(keys.publicKey).toHaveLength(32);
    expect(keys.privateKey).toHaveLength(32);
  });

  test("sign and verify roundtrip", async () => {
    const keys = await generateKeyPair();
    const message = new TextEncoder().encode("test message");

    const sig = await sign(message, keys.privateKey);
    const valid = await verify(sig, message, keys.publicKey);

    expect(valid).toBe(true);
  });

  test("createAID derives stable identifier from public key", () => {
    const pubKey = new Uint8Array(32).fill(0xaa);
    const aid = createAID(pubKey);

    expect(aid).toMatch(/^E[A-Za-z0-9_-]+$/);
    expect(createAID(pubKey)).toBe(aid); // Deterministic
  });
});
```

**Implementation**:
```ts
// core/crypto.ts
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

export interface KeyPair {
  publicKey: Uint8Array; // 32 bytes
  privateKey: Uint8Array; // 32 bytes
}

export async function generateKeyPair(): Promise<KeyPair> {
  const privateKey = ed.utils.randomPrivateKey();
  const publicKey = await ed.getPublicKeyAsync(privateKey);

  return { publicKey, privateKey };
}

export async function sign(message: Uint8Array, privateKey: Uint8Array): Promise<Uint8Array> {
  return await ed.signAsync(message, privateKey);
}

export async function verify(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array
): Promise<boolean> {
  try {
    return await ed.verifyAsync(signature, message, publicKey);
  } catch {
    return false;
  }
}

export function createAID(publicKey: Uint8Array): string {
  // KERI-style AID: 'E' prefix + base64url(publicKey)
  // Simplified - production would use proper CESR encoding
  const b64 = uint8ArrayToBase64Url(publicKey);
  return `E${b64}`;
}

function uint8ArrayToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  return base64.replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=/g, "");
}
```

#### Step 4.3: Update test helpers
```ts
// tests/helpers/crypto-utils.ts
import { generateKeyPair as coreGenerateKeyPair, createAID } from "../../core/crypto";

export { generateKeyPair, createAID } from "../../core/crypto";

export function encodeCESRKey(publicKey: Uint8Array): string {
  // Simplified CESR: 'D' prefix + base64url
  const b64 = uint8ArrayToBase64Url(publicKey);
  return `D${b64}`;
}

// ... rest of existing test helpers, updated to use core/crypto
```

**Acceptance Criteria (Milestone 4)**:
- [ ] `core/crypto.ts` with generateKeyPair, sign, verify, createAID
- [ ] @noble/ed25519 dependency added
- [ ] libsodium-wrappers-sumo removed
- [ ] All existing tests updated to use new crypto module
- [ ] Tests pass with new crypto implementation

---

### Milestone 5: Unified Client SDK

**Goal**: Update `src/client.ts` to use core interfaces

#### Step 5.1: Refactor MessageBusClient
**Before**: Direct Convex calls
**After**: Uses Transport, IdentityAuth, GroupApi interfaces

```ts
// src/client.ts (refactored)
import { ConvexClient } from "convex/browser";
import { ConvexIdentityAuth } from "../convex/auth-adapter";
import { ConvexTransport } from "../convex/messages-adapter";
import { ConvexGroupApi } from "../convex/groups-adapter";
import { IdentityAuth } from "../core/interfaces/IdentityAuth";
import { Transport } from "../core/interfaces/Transport";
import { GroupApi } from "../core/interfaces/GroupApi";

export interface MeritsClient {
  identity: IdentityAuth;
  transport: Transport;
  group: GroupApi;
  close(): void;
}

export function createMeritsClient(convexUrl: string): MeritsClient {
  const convex = new ConvexClient(convexUrl);

  return {
    identity: new ConvexIdentityAuth(convex),
    transport: new ConvexTransport(convex),
    group: new ConvexGroupApi(convex),
    close: () => convex.close(),
  };
}

// Legacy compatibility
export class MessageBusClient {
  private client: MeritsClient;

  constructor(convexUrl: string) {
    this.client = createMeritsClient(convexUrl);
  }

  // Delegate to new interface-based client
  async send(recpAid: string, ct: string, credentials: any, options?: any) {
    // Build auth proof...
    const auth = await this.createAuth(credentials, "send", { /* ... */ });

    return await this.client.transport.sendMessage({
      to: recpAid,
      ct,
      typ: options?.typ,
      ek: options?.ek,
      alg: options?.alg,
      ttlMs: options?.ttl,
      auth,
    });
  }

  // ... other methods delegating to interfaces
}
```

**Test**: Existing integration tests should work with minimal changes

**Acceptance Criteria (Milestone 5)**:
- [ ] `createMeritsClient()` returns interface-based client
- [ ] Legacy `MessageBusClient` wraps new client for compatibility
- [ ] All existing integration tests pass
- [ ] New tests use `createMeritsClient()` directly

---

### Milestone 6: Documentation & Examples

**Goal**: Document the architecture and provide usage examples

#### Deliverables
1. **Architecture diagram** (Mermaid or ASCII)
   ```
   ┌─────────────────┐
   │  Application    │
   │  (UI/Bot/CLI)   │
   └────────┬────────┘
            │ uses
   ┌────────▼────────┐
   │  Merits Client  │
   │  (src/client)   │
   └────────┬────────┘
            │ implements
   ┌────────▼────────────────────────┐
   │  Core Interfaces                │
   │  - IdentityAuth                 │
   │  - Transport (+ subscribe)      │
   │  - GroupApi                     │
   │  - MessageRouter                │
   └────────┬────────────────────────┘
            │ backend-agnostic
   ┌────────▼────────────────────────┐
   │  Convex Backend (reference)     │
   │  - ConvexIdentityAuth           │
   │  - ConvexTransport              │
   │  - ConvexGroupApi               │
   │  - auth.ts, messages.ts,        │
   │    authorization.ts, groups.ts  │
   └─────────────────────────────────┘
   ```

2. **Usage examples**
   - `examples/chat-client.ts`: Simple chat using router
   - `examples/group-chat.ts`: Group messaging example
   - `examples/subscribe.ts`: Live message feed with auto-ack

3. **API reference** (generated from TSDoc)

4. **Migration guide** for existing code

**Acceptance Criteria (Milestone 6)**:
- [ ] Architecture diagram in docs/architecture.md
- [ ] 3 working examples in examples/
- [ ] API reference in docs/api.md
- [ ] Migration guide in docs/migration.md

---

## Makefile Integration

Update top-level Makefile to orchestrate all test types:

```makefile
.PHONY: test test-unit test-integration test-watch test-coverage install dev clean summarise

# Run all tests
test: test-unit test-integration

# Unit tests (fast, no Convex)
test-unit:
	@echo "Running unit tests..."
	bun test tests/unit/**/*.test.ts

# Integration tests (requires Convex)
test-integration:
	@echo "Running integration tests..."
	@if [ ! -f .env.local ]; then \\
		echo "Error: .env.local file not found"; \\
		echo "Please run 'make dev' first to set up your Convex deployment"; \\
		exit 1; \\
	fi
	@export $$(grep -v '^#' .env.local | sed 's/#.*//g' | xargs) && \\
		bun test tests/integration/**/*.test.ts

# Watch mode for development
test-watch:
	bun test --watch

# Test coverage report
test-coverage:
	bun test --coverage

# Install dependencies
install:
	bun install

# Start Convex dev server
dev:
	bunx convex dev

# CLI tool
cli:
	@if [ ! -f .env.local ]; then \\
		echo "Error: .env.local file not found"; \\
		echo "Please run 'make dev' first"; \\
		exit 1; \\
	fi
	@export $$(grep -v '^#' .env.local | xargs) && bun run cli

# Clean up generated files
clean:
	rm -rf node_modules
	rm -rf convex/_generated
	rm -f merits-summary.txt

# Generate summary of convex files and copy to clipboard
summarise:
	@./scripts/summarise.sh
	@cat merits-summary.txt | pbcopy
	@echo "Summary copied to clipboard"
```

---

## Migration Sequence Summary

### Week 1: Foundation
- [ ] **Day 1-2**: Milestone 0 (Test reorganization, missing coverage)
- [ ] **Day 3-5**: Milestone 1 (Core interfaces: IdentityAuth, Transport)

### Week 2: Features
- [ ] **Day 1-2**: Milestone 2 (MessageRouter)
- [ ] **Day 3-5**: Milestone 3 (GroupApi, server-side fanout)

### Week 3: Polish
- [ ] **Day 1-2**: Milestone 4 (Crypto cleanup with @noble/ed25519)
- [ ] **Day 3-4**: Milestone 5 (Unified client SDK)
- [ ] **Day 5**: Milestone 6 (Documentation & examples)

---

## Success Metrics

### Code Quality
- [ ] Test coverage >85% (unit + integration)
- [ ] Zero type errors with strict TypeScript
- [ ] All linting rules pass

### Interface Contracts
- [ ] IdentityAuth, Transport, GroupApi fully tested
- [ ] Convex implementations pass all interface tests
- [ ] Router handles 5+ message types in tests

### Features Complete
- [ ] Subscribe/push working with auto-ack
- [ ] Group messaging with server-side fanout
- [ ] Full onboarding flow (unknown → known → verified)
- [ ] Admin operations (grant/revoke roles)

### Documentation
- [ ] Architecture diagram
- [ ] 3+ working examples
- [ ] Migration guide for existing users
- [ ] API reference with TSDoc

---

## Future: Package Split (Post-Migration)

Once all milestones are complete, optionally split into packages:

```
packages/
├── merits-core/          # Pure TS, no backend deps
│   ├── types.ts
│   ├── interfaces/
│   ├── runtime/
│   └── crypto.ts
├── merits-convex/        # Convex backend
│   ├── adapters/
│   ├── convex/
│   └── tests/
└── merits-client/        # SDK for apps
    ├── index.ts
    └── examples/
```

But for now, monorepo evolution is faster and less risky.

---

## Next Steps

Ready to begin? Suggested first actions:

1. **Review this plan** - ask questions, refine priorities
2. **Run `make test`** - establish baseline (what passes/fails today)
3. **Start Milestone 0** - reorganize tests, add missing coverage
4. **TDD loop**: Write interface tests → implement → refactor → repeat

Let me know when you'd like to start, and which milestone feels most urgent!
