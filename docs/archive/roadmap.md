# Merits Roadmap (v2)

> Goal: a backend-agnostic, KERI-authenticated message bus with:
> - portable API surfaces (`IdentityAuth`, `Transport`, `GroupApi`)
> - canonical data models defined via TypeBox
> - strongly typed message routing for apps
> - Convex as the first reference implementation
> - robust integration tests that prove the contract

This roadmap is what we will implement.

---

## 0. Guiding Principles

1. **Functional core, explicit effects**
   - Pure modules for data shaping, validation, routing, signature verification, etc.
   - Side-effect-y modules (Convex I/O, persistence, encryption helpers) wrap those.

2. **Interop-first**
   - Everything is parameterized by AIDs and key states from KERI, not local “accounts”.
   - Auth is “prove you control this AID right now” via challenge/response.

3. **Stable interfaces**
   - We'll ship core interfaces (`IdentityAuth`, `Transport`, `GroupApi`) that any backend can implement (Convex, Kafka, etc).
   - Convex is our reference backend.

4. **Extensible application payloads**
   - The message bus doesn’t care whether a message is “chat text”, “rotation proposal”, “workflow event”, etc.
   - We define a generic envelope + content type (`typ`) that lets app layer dispatch cleanly.


see [vision](./vision.md)
---

## 1. Packages / Directory Layout

We split into two packages:

### `packages/merits-core/`
Pure TypeScript. No Convex imports.

Contains:
- TypeBox schemas
- types/interfaces for:
  - `AID`, `KeyState`, `AuthProof`
  - `IdentityAuth`, `Transport`, `GroupApi`
- message routing helpers
- factories / validators for all request+response structs
- lightweight crypto helpers (Ed25519 verify, canonical hash, etc.) with explicit dependency injection for browser vs Node

This is portable.

### `packages/merits-convex/`
Convex implementation of those interfaces.

Contains:
- Convex `schema.ts`
- Convex mutations/queries/actions that implement `IdentityAuth`, `Transport`, `GroupApi`
- adapter classes that conform to the core interfaces
- integration tests that run against Convex local runtime

---

## 2. Core Data Structures (TypeBox)

We will declare TypeBox schemas in `merits-core/src/schemas/*.ts`.

We’ll always export:
- the `TypeBox` object (e.g. `MessageSendRequestSchema`)
- the inferred TS type (e.g. `export type MessageSendRequest = Static<typeof MessageSendRequestSchema>`)
- a namespace with helpers (factory, validators, etc.)

### 2.1 Shared primitives

```ts
// merits-core/src/schemas/primitives.ts
import { Type, Static } from "@sinclair/typebox";

/**
 * A decentralized identifier for a controller in KERI.
 * Example: "Eabc123...".
 */
export const AIDSchema = Type.String({
  $id: "AID",
  description: "Autonomic Identifier (AID) of a KERI controller.",
  examples: ["Eabc123def...", "Bxyz456..."],
  minLength: 8,
});

export type AID = Static<typeof AIDSchema>;

/**
 * Indexed signature format "idx-base64url"
 * Example: "0-5QbK7e..."
 */
export const IndexedSigSchema = Type.String({
  $id: "IndexedSig",
  description:
    "Indexed detached signature in KERI style. '<index>-<sigB64Url>'. Index selects which key signed.",
  examples: ["0-Alx5JH2kKci...", "1-Z_y9QbMH9..."],
});

export type IndexedSig = Static<typeof IndexedSigSchema>;

/**
 * Authentication proof derived from challenge/response.
 * The server will verify this proof before performing any privileged action.
 */
export const AuthProofSchema = Type.Object(
  {
    challengeId: Type.String({
      description:
        "Opaque server-issued challenge identifier returned by IdentityAuth.issueChallenge().",
      examples: ["ch_01HZY2...", "c-9a1b2c3d4e5f"],
    }),
    sigs: Type.Array(IndexedSigSchema, {
      description:
        "Array of indexed signatures over the canonical challenge payload. Must satisfy the AID's current threshold.",
      minItems: 1,
    }),
    ksn: Type.Number({
      description:
        "Key Sequence Number the client believes is currently valid for that AID. Must match server's KeyState.ksn.",
      examples: [3, 12],
      minimum: 0,
    }),
  },
  {
    $id: "AuthProof",
    description:
      "Caller-supplied authentication proof: 'I currently control this AID and I authorize this exact action (argsHash/purpose)'.",
  }
);

export type AuthProof = Static<typeof AuthProofSchema>;
```

### 2.2 MessageSendRequest

```ts
// merits-core/src/schemas/message.ts
import { Type, Static } from "@sinclair/typebox";
import { AIDSchema, AuthProofSchema } from "./primitives";

/**
 * MessageSendRequest:
 * A request for the server to enqueue an encrypted message for a single recipient.
 *
 * Notes:
 * - `ct` is already encrypted for `to`.
 * - `typ` is an application-level discriminator ("chat.text.v1", "kel.proposal", "my.app.ack.v2").
 * - `ttlMs` tells the server how long to keep the message before auto-expiry.
 * - `auth` proves the caller controls the sending AID.
 */
export const MessageSendRequestSchema = Type.Object(
  {
    to: AIDSchema,
    ct: Type.String({
      description:
        "Ciphertext body sealed for the recipient AID. The server cannot decrypt this.",
      examples: ["gAAAAABlZ... (base64url-encoded ciphertext)"],
      minLength: 16,
    }),
    typ: Type.Optional(
      Type.String({
        description:
          "Application-level type tag for routing. Examples: 'chat.text.v1', 'kel.proposal', 'my.app.ack.v2'.",
        examples: ["chat.text.v1", "my.app.ack.v2", "kel.proposal"],
      })
    ),
    ek: Type.Optional(
      Type.String({
        description:
          "Ephemeral sender public key for PFS (e.g. X25519). Lets recipient derive a shared secret.",
        examples: ["Xf21abc..."],
      })
    ),
    alg: Type.Optional(
      Type.String({
        description:
          "Encryption algorithm identifier for `ct`. Helps the recipient choose the right decrypt routine.",
        examples: ["x25519-xchacha20poly1305"],
      })
    ),
    ttlMs: Type.Optional(
      Type.Number({
        description:
          "How long the server should retain this message (in ms). After expiry, server can drop it.",
        minimum: 1000,
        maximum: 7 * 24 * 60 * 60 * 1000, // 7 days
        default: 24 * 60 * 60 * 1000, // 24h default
        examples: [60000, 86400000],
      })
    ),
    auth: AuthProofSchema,
  },
  {
    $id: "MessageSendRequest",
    description:
      "Client request to enqueue a one-to-one encrypted message for delivery. 'auth' authenticates and rate-limits the sender.",
  }
);

export type MessageSendRequest = Static<typeof MessageSendRequestSchema>;

/**
 * EncryptedMessage:
 * Returned to recipients. Everything needed to:
 * - decide how to route/decode the message
 * - verify who sent it and when
 * - prove non-repudiation
 */
export const EncryptedMessageSchema = Type.Object(
  {
    id: Type.String({
      description: "Server-issued message ID / SAID of envelope.",
      examples: ["msg_01HZ...", "bafy..."],
    }),

    from: AIDSchema,
    to: AIDSchema,

    ct: Type.String({
      description: "Ciphertext sealed to `to`. Application payload lives in here.",
    }),

    ek: Type.Optional(
      Type.String({
        description: "Ephemeral sender public key (PFS).",
      })
    ),

    alg: Type.Optional(
      Type.String({
        description: "Encryption algorithm identifier.",
      })
    ),

    typ: Type.Optional(
      Type.String({
        description:
          "Application message type tag. Used by routers to dispatch to app logic.",
      })
    ),

    createdAt: Type.Number({
      description: "Server timestamp (ms since epoch) when message was accepted.",
    }),

    expiresAt: Type.Number({
      description: "Server timestamp (ms since epoch) when server plans to drop this message.",
    }),

    envelopeHash: Type.String({
      description:
        "Deterministic hash(binding headers+ctHash). Used for auditing and delivery receipts.",
      examples: ["sha256:abc123..."],
    }),

    senderProof: Type.Object({
      sigs: Type.Array(
        Type.String({
          description: "Indexed signatures from sender proving AID control.",
        }),
        { description: "Threshold-satisfying sig set at time of send." }
      ),
      ksn: Type.Number({
        description:
          "Sender's Key Sequence Number at send time. Guards against replay after rotation.",
      }),
      evtSaid: Type.String({
        description:
          "SAID of sender's last KEL event that established/rotated keys at the time of send.",
      }),
    }),
  },
  {
    $id: "EncryptedMessage",
    description:
      "Delivery representation of a message queued for (and retrieved by) a recipient AID. Includes sender’s cryptographic proof.",
  }
);

export type EncryptedMessage = Static<typeof EncryptedMessageSchema>;

/**
 * Namespace helpers for MessageSendRequest.
 */
export namespace MessageSendRequest {
  /**
   * Create a new MessageSendRequest from user-friendly params.
   * This enforces consistent field names and gives IDE autocomplete.
   */
  export function create(input: {
    to: string;
    ciphertext: string;
    typ?: string;
    ek?: string;
    alg?: string;
    ttlMs?: number;
    auth: {
      challengeId: string;
      sigs: string[];
      ksn: number;
    };
  }): MessageSendRequest {
    return {
      to: input.to,
      ct: input.ciphertext,
      typ: input.typ,
      ek: input.ek,
      alg: input.alg,
      ttlMs: input.ttlMs,
      auth: input.auth,
    };
  }

  /**
   * Helper for plain text chat messages.
   * Caller gives plaintext, we return (typ + still-plaintext).
   * App can then encrypt+seal it separately before calling sendMessage.
   * This keeps "chat.text.v1" consistent across clients.
   */
  export function createChatTextDraft(input: {
    to: string;
    text: string;
    auth: {
      challengeId: string;
      sigs: string[];
      ksn: number;
    };
    ttlMs?: number;
  }): {
    draftTyp: string;      // "chat.text.v1"
    plaintextBody: { t: string; ts: number };
    to: string;
    ttlMs?: number;
    auth: {
      challengeId: string;
      sigs: string[];
      ksn: number;
    };
  } {
    return {
      draftTyp: "chat.text.v1",
      plaintextBody: {
        t: input.text,
        ts: Date.now(),
      },
      to: input.to,
      ttlMs: input.ttlMs,
      auth: input.auth,
    };
  }
}
```

### 2.3 Group structures

```ts
// merits-core/src/schemas/group.ts
import { Type, Static } from "@sinclair/typebox";
import { AIDSchema, AuthProofSchema } from "./primitives";

export const GroupPolicyHintSchema = Type.Union(
  [
    Type.Object({
      kind: Type.Literal("broadcast"),
    }),
    Type.Object({
      kind: Type.Literal("raft"),
      quorum: Type.Number({
        description: "Number of cosigners required to advance group log.",
        minimum: 1,
      }),
    }),
    Type.Object({
      kind: Type.Literal("restricted"),
      admins: Type.Array(AIDSchema, {
        description: "AIDs allowed to post to this group.",
      }),
    }),
  ],
  {
    description:
      "Soft hint about how the group wants to coordinate / order messages.",
  }
);

export type GroupPolicyHint = Static<typeof GroupPolicyHintSchema>;

export const GroupStateSchema = Type.Object(
  {
    groupId: Type.String({
      description: "Logical group identifier.",
      examples: ["grp:friends-chat", "grp:onboarding:12345"],
    }),
    members: Type.Array(AIDSchema, {
      description: "Current explicit members of the group.",
      minItems: 1,
    }),
    policy: Type.Optional(GroupPolicyHintSchema),
    createdAt: Type.Number({
      description: "Server timestamp (ms since epoch).",
    }),
    createdBy: AIDSchema,
  },
  {
    $id: "GroupState",
    description: "Declared membership and policy for a group.",
  }
);

export type GroupState = Static<typeof GroupStateSchema>;

/**
 * Request sent to GroupApi.sendGroupMessage
 * Option 1: perRecipient fanout (already-sealed ct per AID)
 * Option 2: plaintext (server will seal per member)
 */
export const GroupSendRequestSchema = Type.Object(
  {
    groupId: Type.String(),
    perRecipient: Type.Optional(
      Type.Record(
        AIDSchema,
        Type.Object({
          ct: Type.String({
            description:
              "Ciphertext already sealed for that specific recipient.",
          }),
          ek: Type.Optional(
            Type.String({ description: "Ephemeral sender pubkey." })
          ),
          alg: Type.Optional(
            Type.String({ description: "Cipher algorithm identifier." })
          ),
        })
      )
    ),
    plaintext: Type.Optional(
      Type.String({
        description:
          "Plaintext body for the server to encrypt+fanout. ONLY allowed if server is trusted to seal per member. In a strict E2E world, clients should prefer perRecipient.",
      })
    ),
    typ: Type.Optional(
      Type.String({
        description:
          "App-level discriminator for routing, e.g. 'chat.text.v1'.",
      })
    ),
    ttlMs: Type.Optional(
      Type.Number({
        description:
          "How long (ms) those fanned-out messages should be stored.",
        minimum: 1000,
        maximum: 7 * 24 * 60 * 60 * 1000,
      })
    ),
    auth: AuthProofSchema,
  },
  {
    $id: "GroupSendRequest",
    description:
      "Client request to send a message into a group. Server may fanout into N direct messages.",
  }
);

export type GroupSendRequest = Static<typeof GroupSendRequestSchema>;
```

---

## 3. Message Routing for Apps

We want thin bus / rich apps. Rule:

- The bus moves encrypted blobs + metadata.
- App code decides how to interpret each message based on `typ`.

Router helper:

```ts
// merits-core/src/runtime/router.ts
import { EncryptedMessage } from "../schemas/message";

export interface MessageHandlerContext {
  decrypt: (m: EncryptedMessage) => Promise<unknown>; 
  // app injects its decrypt logic: given ct+ek+alg, return plaintext object
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
      // decrypt application payload
      const plaintext = await ctx.decrypt(msg);

      const t = msg.typ ?? "unknown";
      const handler = handlers.get(t);
      if (!handler) {
        // optional: fallback log/metrics
        return;
      }
      return handler(msg, plaintext);
    },
  };
}
```

Usage:
- Frontend or bot registers:
  - `"chat.text.v1"` → render chat bubble
  - `"my.app.ack.v2"` → update workflow state
  - `"kel.proposal"` → feed into rotation UI
- After `Transport.receiveMessages`, you invoke `router.dispatch(ctx, msg)` for each message.

This gives:
- pluggable message types without touching bus core
- consistent `typ` conventions across clients
- the ability to E2E encrypt arbitrary app payloads

---

## 4. Interfaces (portable service contracts)

These are backend-agnostic contracts Convex will implement.

### 4.1 IdentityAuth

```ts
// merits-core/src/api/IdentityAuth.ts
import { AuthProof } from "../schemas/primitives";

export interface IssueChallengeRequest {
  aid: string;
  purpose:
    | "send"
    | "receive"
    | "ack"
    | "admin"
    | "sendGroup"
    | "manageGroup";
  args: Record<string, unknown>; // to be hashed (argsHash)
  ttlMs?: number;
}

export interface IssueChallengeResponse {
  challengeId: string;
  payloadToSign: {
    ver: "msg-auth/1";
    aud: string;
    ts: number;
    nonce: string;
    aid: string;
    purpose: string;
    argsHash: string;
  };
}

export interface VerifyAuthRequest {
  proof: AuthProof;
  expectedPurpose: IssueChallengeRequest["purpose"];
  args: Record<string, unknown>;
}

export interface VerifyAuthResult {
  aid: string;
  ksn: number;
  evtSaid: string;
}

export interface IdentityAuth {
  issueChallenge(req: IssueChallengeRequest): Promise<IssueChallengeResponse>;
  verifyAuth(req: VerifyAuthRequest): Promise<VerifyAuthResult>;
}
```

### 4.2 Transport

```ts
// merits-core/src/api/Transport.ts
import {
  MessageSendRequest,
  EncryptedMessage,
} from "../schemas/message";
import { AuthProof } from "../schemas/primitives";

export interface Transport {
  sendMessage(req: MessageSendRequest): Promise<{ messageId: string }>;

  receiveMessages(req: {
    for: string;
    auth: AuthProof;
  }): Promise<EncryptedMessage[]>;

  ackMessage(req: {
    messageId: string;
    auth: AuthProof;
    receiptSig?: string[]; // recipient's indexed sigs over envelopeHash
  }): Promise<void>;

  listUnread?(req: {
    for: string;
    auth: AuthProof;
  }): Promise<EncryptedMessage[]>;
}
```

### 4.3 GroupApi

```ts
// merits-core/src/api/GroupApi.ts
import {
  GroupState,
  GroupSendRequest,
} from "../schemas/group";
import { AuthProof } from "../schemas/primitives";

export interface GroupApi {
  upsertGroup(req: {
    groupId: string;
    members: string[];
    policy?: { kind: string; [k: string]: any };
    auth: AuthProof;
  }): Promise<GroupState>;

  getGroup(req: {
    groupId: string;
    auth: AuthProof;
  }): Promise<GroupState>;

  sendGroupMessage(req: GroupSendRequest): Promise<{
    deliveries: Array<{ to: string; messageId: string }>;
  }>;
}
```

---

## 5. Integration Test Plan

We'll create `packages/merits-convex/tests/integration/*.test.ts` (Bun/Vitest/Jest is fine, but keep deterministic clocks and fixed keys).

### 5.1 Setup helpers

Test harness will:
1. Start Convex local (or in-memory Convex test runtime).
2. Bootstrap:
   - create two AIDs: `alice`, `bob`
   - register their KeyStates with deterministic keys/ksn
   - bootstrap an onboarding admin and tiers as needed
3. Provide deterministic Ed25519 keypairs for alice/bob so we can generate valid signatures.

### 5.2 IdentityAuth tests

- `issueChallenge` with purpose `"send"` and args `{ to: bobAid, ctHash, ttlMs }` returns:
  - `payloadToSign` containing correct `argsHash`
  - `challengeId`
- We locally sign `payloadToSign` with alice's key 0 → build `AuthProof`.
- Call `verifyAuth` with that proof and same args:
  - expect `aid = alice`, `ksn` matches
  - expect it rejects if:
    - we tamper args
    - we use wrong purpose
    - we replay after `used=true`
    - we advance alice's KeyState.ksn and reuse old `ksn`

This proves replay prevention + KERI-style threshold binding.

### 5.3 Transport tests

- `sendMessage` from alice → bob
  - Build request with `MessageSendRequest.create(...)`
  - Auth is alice’s proof for `"send"`
  - Expect:
    - Convex stores message with `senderAid = alice`
    - `typ` persisted
    - correct TTL enforcement
    - `senderSig`, `senderKsn`, `senderEvtSaid` recorded
    - rate limit incremented
    - returns `messageId`

- `receiveMessages` as bob
  - Auth is bob’s proof for `"receive"`
  - Expect:
    - Only bob’s messages are returned
    - EncryptedMessage objects match `EncryptedMessageSchema`
    - `from === alice`, `to === bob`

- `ackMessage` as bob
  - Auth is bob’s proof for `"ack"`
  - Acknowledges that messageId
  - Expect message marked retrieved
  - Expect server stores bob’s receiptSig if provided
  - Expect message will no longer appear in `receiveMessages`

- Expiry cleanup
  - Force TTL small
  - Jump clock
  - Run cleanup
  - Expect expired messages gone

### 5.4 Authorization / onboarding flow tests

- alice tier = "unknown"
- bob is NOT onboarding admin → `sendMessage(alice→bob)` should fail.
- make bob onboarding admin
- retry → should pass
- promote alice to "known"
- now alice can message anyone (remove dependency on onboarding admin)

This proves:
- per-tier send policy
- server-side enforcement (not client-claimed)

### 5.5 GroupApi tests (after we add groups)

- Create `groupId="grp:test"`, members `[alice, bob]`
  - Auth proof from alice with purpose `"manageGroup"`
  - Expect `GroupState.members` includes alice+bob
- Send group message
  - alice calls `sendGroupMessage` with `plaintext: "hello team", typ:"chat.text.v1"`
  - Expect Convex:
    - fans out N direct messages using `Transport.sendMessage`
    - logs consistent ordering (groupLog entry)
  - bob does `receiveMessages` ("receive" proof)
    - expect a message with `typ:"chat.text.v1"` and `from:alice`
- Confirm router
  - In test: decrypt plaintext, run through `createMessageRouter()`
  - register handler for `"chat.text.v1"`
  - assert handler fired with `"hello team"`

---

## 6. Milestones

### Milestone 1 — merits-core skeleton
- [ ] Add `merits-core/` with:
  - `schemas/primitives.ts` (AID, AuthProof, etc.)
  - `schemas/message.ts` (MessageSendRequest, EncryptedMessage)
  - `schemas/group.ts` (GroupState, GroupSendRequest)
  - `runtime/router.ts` (MessageRouter)
  - `api/IdentityAuth.ts`, `api/Transport.ts`, `api/GroupApi.ts`
- [ ] Each schema gets a namespace with at least one helper factory (`MessageSendRequest.create`, etc.).

✅ Output: typed, documented, validated models independent of Convex

---

### Milestone 2 — merits-convex implementation for IdentityAuth + Transport
- [ ] Refactor existing Convex functions:
  - `issueChallenge`, `verifyAuth` → class `ConvexIdentityAuth implements IdentityAuth`
  - `messages.send`, `messages.receive`, `messages.acknowledge`, `messages.list` → class `ConvexTransport implements Transport`
- [ ] Ensure Convex request/response structs match the TypeBox-derived types in `merits-core`
- [ ] Keep tier/rate limiting logic (`authorization.ts`) but make it internal to ConvexTransport.sendMessage()

✅ Output: working Convex backend that satisfies the generic interfaces

---

### Milestone 3 — GroupApi (fanout groups)
- [ ] Add Convex tables for:
  - `groups` (groupId, members[], policy, createdAt, createdBy)
  - `groupLog` (groupId, seq, envelopeHash, senderAid, createdAt)
- [ ] Add Convex mutations:
  - `group.upsertGroup` → `GroupApi.upsertGroup`
  - `group.getGroup` → `GroupApi.getGroup`
  - `group.send` → `GroupApi.sendGroupMessage`
    - does per-recipient fanout via `ConvexTransport.sendMessage`
    - appends ordering entry to `groupLog`
- [ ] Add tests that group messages arrive as normal direct messages with the expected `typ`

✅ Output: group fanout + shared ordering log hook

---

### Milestone 4 — Integration tests
- [ ] Deterministic Ed25519 test keys for alice/bob
- [ ] Deterministic clock (inject now() or override Date.now in tests)
- [ ] Tests for all flows in §5:
  - Auth
  - Send/receive/ack
  - Tier enforcement
  - Group fanout
  - Router dispatch

✅ Output: high-confidence contract you can port to Kafka or Postgres

---

## 7. What you get at the end

When you finish Milestone 4 you will have:

- A portable spec in `merits-core`:
  - documented TypeBox schemas + generated TS types
  - small helper factories (`MessageSendRequest.create`, etc.)
  - a pluggable `MessageRouter` for app-level message handling

- A Convex reference implementation in `merits-convex`:
  - `ConvexIdentityAuth`, `ConvexTransport`, `ConvexGroupApi`
  - Convex tables enforcing tiered onboarding, rate limits, expiry, delivery receipts
  - Integration tests that prove the security model (challenge/response, KERI key rotation, replay prevention, etc.)

- A clean story for applications:
  - To send: build `MessageSendRequest` with `typ` = `"chat.text.v1"` or `"my.app.ack.v2"`, encrypt, `Transport.sendMessage`
  - To receive: `Transport.receiveMessages`, then `router.dispatch(ctx, msg)` to invoke business logic without touching bus internals
  - To grow: add new message types by registering new router handlers, not by changing core

This is the stable baseline for “merits” going forward.
