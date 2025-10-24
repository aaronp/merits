# Merits Vision Summary — Client Perspective

> A privacy-first message bus where clients **prove control of their KERI AIDs** and exchange **end-to-end encrypted messages**, individually or in groups, through a minimal, type-safe API.

---

## 💠 Setup: Merits Client

The **Merits SDK** bundles schema definitions, type validators, and backend adapters (Convex by default).

```ts
import { Merits, IssueChallenge, MessageSendRequest } from "merits-client";

// Uses 12-factor config (from env or .env.local):
// MERITS_BACKEND_URL, MERITS_APP_ID, MERITS_API_KEY, etc.
const client: Merits = await Merits.default();
```

---

## 1️⃣ Authenticate — “Prove Control of AID”

Rather than “logging in”, clients prove that they currently control a KERI AID.

```ts
// Step 1: Request a challenge for the "send" purpose
const challenge = await client.identity.issueChallenge(
  IssueChallenge.send(aliceAid, bobAid, {
    args: { ctHash: "sha256:abc123..." },
  })
);

// Step 2: Sign the canonical payload with your AID's current keys
const sigs = keri.signIndexed(challenge.payloadToSign, aliceKeys);

// Step 3: Construct AuthProof to attach to subsequent API calls
const auth = {
  challengeId: challenge.challengeId,
  sigs,
  ksn: aliceKsn,
};
```

✅ No passwords, sessions, or secrets — just verifiable, threshold-aware control proofs.

---

## 2️⃣ Send a Direct Message

Messages are opaque ciphertexts delivered via the transport layer.

```ts
// Encrypt a plaintext for Bob using his current public key
const ciphertext = encryptFor(bobAid, { text: "hello world" });

// Use our schema factory to build a properly-typed message
const msg = MessageSendRequest.create({
  to: bobAid,
  ciphertext,
  typ: "chat.text.v1",
  auth,
});

// Send via the transport API
await client.transport.sendMessage(msg);
```

🧠  `typ` acts as a message router hint (“chat.text.v1”, “kel.proposal”, etc.).

---

## 3️⃣ Create a Group

Groups are addressable entities with explicit membership and optional policies.

```ts
await client.group.upsertGroup({
  groupId: "grp:team-alpha",
  members: [aliceAid, bobAid, carolAid],
  policy: { kind: "broadcast" },
  auth,
});
```

👥  Everyone can now send to `grp:team-alpha` through their usual message flow.

---

## 4️⃣ Send a Group Message

Messages to groups automatically fan-out one-to-one encryptions.

```ts
await client.group.sendGroupMessage({
  groupId: "grp:team-alpha",
  plaintext: encryptForGroup("Hello team 👋"),
  typ: "chat.text.v1",
  ttlMs: 86_400_000, // 24h
  auth,
});
```

✅  The server fans out encrypted messages for each member.  
✅  Group ordering and logs stay consistent with the group policy.

---

## 5️⃣ Receive Messages

### Option A: Pull unread now

```ts
const unread = await client.transport.receiveMessages({
  for: aliceAid,
  auth,
});

for (const msg of unread) {
  await router.dispatch(ctx, msg);
  await client.transport.ackMessage({ messageId: msg.id, auth });
}
```

### Option B: Subscribe (push, auto-ack on success)

```ts
const router = createMessageRouter();
router.register("chat.text.v1", (msg, plaintext) => {
  ui.addChatBubble(msg.from, plaintext.text);
});

const cancel = await client.transport.subscribe({
  for: aliceAid,
  auth,
  onMessage: async (msg) => {
    await router.dispatch(ctx, msg);
    return true; // ack it after successful handling
  },
  onError: (err) => {
    ui.showConnectionWarning(err);
  },
});

// call cancel() to stop listening
```

**Contract details:**
- `subscribe` starts a live feed for messages addressed to `for`.
- Returns a `cancel()` handle.
- `onMessage(msg)`:
  - If it resolves `true`, message is marked read/acknowledged.
  - If `false` or `undefined`, message stays unread for retry.
- `onError(err)` fires on network/auth failures.

---

## 6️⃣ Admin Functions

Admin proofs (`purpose:"admin"`) let you manage ACLs, throttling, and usage stats.

```ts
// Manage user tiers and permissions
await client.admin.onboardUser({
  userAid: newcomerAid,
  onboardingProof: saidOfWelcome,
  auth, // admin proof
});

await client.admin.updateRateLimit({ aid: aliceAid, limit: 100 });

// Inspect system-level usage metrics
const stats = await client.admin.getTierStats();
const usage = await client.admin.getUsageMetrics();
```

🧾  Every admin action is cryptographically bound to its KERI proof and logged for audit.

---

## 🌐 In One Line

**Merits** lets you:

| Function | Description |
|-----------|--------------|
| 🔐 `issueChallenge` | Prove control of your AID without passwords |
| ✉️ `transport.sendMessage` | Send end-to-end encrypted peer messages |
| 👥 `group.upsertGroup` | Define group membership and policy |
| 🗣 `group.sendGroupMessage` | Broadcast messages to group members |
| 📥 `transport.receiveMessages` | Retrieve and route incoming messages |
| 🔄 `transport.subscribe` | Stream messages live with auto-ack |
| ⚙️ `admin.*` | Manage ACLs, throttling, and usage metrics |

All operations are authenticated via **threshold signatures**, **key-rotation aware**, and **blind to content**.

---

Merits: a **trust-anchored, privacy-preserving message backbone** for people, apps, and organizations.
