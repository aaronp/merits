# 🔐 Merits Auth — Signed Request Specification

**Version:** Draft 1  
**Last updated:** 2025-11-03  
**Authors:** Merits Core Team  

---

## 1. Overview

Merits replaces bearer tokens (JWTs) with **per-request digital signatures** using device-bound Ed25519 keys.

Each HTTP request is **self-authenticating**:  
the request headers, path, method, and body digest are signed directly.  
This removes bearer theft risk and eliminates token TTL drift.

---

## 2. Design Principles

| Goal | Approach |
|------|-----------|
| **No bearer theft** | No stored session token — request proves identity |
| **Replay protection** | Date + Nonce with short replay window |
| **Deterministic verification** | Canonicalized components following IETF draft semantics |
| **Immediate revocation** | Disable the public key → access revoked instantly |
| **Client-friendly** | Works in headless CLI and browser without re-prompting |

---

## 3. Wire Format

### Required Headers

| Header | Description |
|---------|--------------|
| `Date` | RFC 7231 format (e.g. `Mon, 03 Nov 2025 16:20:00 GMT`) |
| `X-Nonce` | UUID v4 or deterministic test nonce |
| `Content-Digest` | `sha-256=:BASE64(SHA256(body)):` — omit for GET/HEAD |
| `Signature-Input` | Canonicalization descriptor (see below) |
| `Signature` | Base64-encoded Ed25519 signature over canonical string |
| `Key-Id` | AID/SAID/DID identifying the public key |

### Canonicalization (IETF draft semantics)

```
Signature-Input: sig1=("@method" "@path" "content-digest" "date" "x-nonce");alg="ed25519"
```

The canonical string is:

```
"@method": GET
"@path": /api/messages
"content-digest": sha-256=:BASE64(...):
"date": Mon, 03 Nov 2025 16:20:00 GMT
"x-nonce": 6c3f0a2f-...
```

Concatenated with `\n`, hashed, and signed using Ed25519.

---

## 4. Example Requests

### 4.1 GET Example

```
GET /api/messages?since=123 HTTP/1.1
Host: api.merits.dev
Date: Mon, 03 Nov 2025 16:20:00 GMT
X-Nonce: 4a3a9b58-3f5c-4f0e-8a97-9c2f08a66a41
Signature-Input: sig1=("@method" "@path" "date" "x-nonce");alg="ed25519"
Signature: sig1=:8Wb7HnF...hw==:
Key-Id: did:keri:EGABCD1234
```

### 4.2 POST Example

```
POST /api/messages HTTP/1.1
Host: api.merits.dev
Date: Mon, 03 Nov 2025 16:20:00 GMT
X-Nonce: 8b2f7e7b-64a6-470e-a018-27cf53df7e94
Content-Type: application/json
Content-Digest: sha-256=:5FZg8vNkZ5...u4x0x8=: 
Signature-Input: sig1=("@method" "@path" "content-digest" "date" "x-nonce");alg="ed25519"
Signature: sig1=:QyKqN6E...7Pw==:
Key-Id: did:keri:EGXYZ5678

{"content":"hello world"}
```

---

## 5. Verification Algorithm (Server)

### Step-by-step

1. **Extract headers:** `Signature`, `Signature-Input`, `Key-Id`, `Date`, `X-Nonce`, `Content-Digest`.
2. **Fetch public key** from Convex by `Key-Id`.
3. **Rebuild canonical string** using `method`, `path`, and listed header values.
4. **Verify signature** via Ed25519.
5. **Replay protection**:
   - Reject if `|now – Date| > 5 min`
   - Reject if `(Key-Id, Nonce)` seen before (store in short-term LRU or Redis with 10 min TTL)
6. **Authorize** using user roles from Convex DB.
7. **Attach** `req.user = { id, roles, permissions }`.

---

## 6. Client Implementation

### 6.1 Signer API

`@merits/auth/signer.ts`
```ts
export async function signRequest(request: Request, keypair: CryptoKeyPair): Promise<Request> {
  const date = new Date().toUTCString()
  const nonce = crypto.randomUUID()
  const body = await request.clone().text()
  const digest = body ? `sha-256=:${btoa(await sha256Base64(body))}:` : undefined

  const signatureInput = digest
    ? `sig1=("@method" "@path" "content-digest" "date" "x-nonce");alg="ed25519"`
    : `sig1=("@method" "@path" "date" "x-nonce");alg="ed25519"`

  const canonical = buildCanonicalString(request.method, request.url, date, nonce, digest)
  const signatureBytes = await crypto.subtle.sign("Ed25519", keypair.privateKey, canonical)
  const signature = `sig1=:${btoa(String.fromCharCode(...new Uint8Array(signatureBytes)))}:`

  const headers = new Headers(request.headers)
  headers.set("Date", date)
  headers.set("X-Nonce", nonce)
  if (digest) headers.set("Content-Digest", digest)
  headers.set("Signature-Input", signatureInput)
  headers.set("Signature", signature)
  headers.set("Key-Id", getKeyId(keypair))

  return new Request(request, { headers })
}
```

---

## 7. Client Key Management

### 7.1 Browser (WebCrypto)
- Use **`crypto.subtle.generateKey({name: "Ed25519", extractable: false})`**
- Store key in **IndexedDB** or **Credential Management API**
- Never export private key
- Optionally mirror to OS keystore via WebAuthn resident credentials

### 7.2 CLI (Node/Bun)
- Use **OS keychain** (macOS Keychain, Windows DPAPI, Linux libsecret)
- Fallback: encrypted local keystore `~/.merits/keys.json` (AES-GCM with user password)
- `merits gen-key` → creates Ed25519 pair, registers with Convex
- `merits list-keys` → shows registered public keys
- `merits revoke-key <key-id>` → disable key instantly server-side

### 7.3 Rotation
- Periodically issue new key (every 6–12 months)
- Append new key event in KERI log, de-activate old one

---

## 8. Replay & Nonce Policy

| Parameter | Value | Notes |
|------------|--------|-------|
| Allowed clock skew | ±5 minutes | Between `Date` and server time |
| Nonce cache TTL | 10 minutes | After which nonce expires |
| Cache size per key | 100 entries | LRU eviction |
| Response on replay | `403 replay-detected` | Log and rate-limit offender |

---

## 9. Migration Plan

| Phase | Action | Outcome |
|-------|---------|----------|
| **0** | Implement signer/verifier modules in parallel with JWT | Dual-auth mode |
| **1** | Add `--signing-only` flag to CLI | Early adopters |
| **2** | Default to signed requests | JWT optional |
| **3** | Remove JWT routes | Full cryptographic auth |
| **4** | Introduce optional multi-sig signing (group endpoints) | Delegated trust |

---

## 10. Example Verification Flow (Merits Server)

```ts
async function verifySignature(req: Request) {
  const keyId = req.headers.get("Key-Id")
  const pubkey = await getPublicKeyById(keyId)

  const signatureInput = parseSigInput(req.headers.get("Signature-Input"))
  const canonical = rebuildCanonicalString(req, signatureInput)
  const signature = base64decode(req.headers.get("Signature"))

  const valid = await ed25519.verify(signature, canonical, pubkey)
  if (!valid) throw new Error("invalid-signature")

  await assertFreshNonce(keyId, req.headers.get("X-Nonce"))
  await assertDateSkew(req.headers.get("Date"))
}
```

---

## 11. Security Considerations

- Every request self-authenticates: no shared secret in transit.
- Private keys **never leave device**.
- Key revocation = immediate cut-off.
- Optional challenge/response bootstrap for first registration.
- Compatible with future **multi-sig** and **delegation** extensions.

---

**End of document**
