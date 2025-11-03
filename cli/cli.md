# Merits CLI

`merits` is the command-line entry point for the **Merits system**.  

Build locally via:

```bash
make build-cli
```

---

## Table of Contents

- [Introduction and Overview](#introduction-and-overview)
- [Global Options](#global-options)
- [User Management](#user-management)
  - [Creating a New Key-Pair](#creating-a-new-key-pair)
  - [Creating a New User](#creating-a-new-user)
  - [Logging In](#logging-in)
  - [Updating Your Key Pair](#updating-your-key-pair)
- [Messaging](#sending-messages)
  - [Encrypting Messages](#encrypting-messages)
  - [Receiving Messages](#receiving-messages)
  - [Marking Messages as Read](#marking-messages-as-read)
- [Groups](#groups)
- [Controls](#controls)
- [Command Summary](#command-summary)
- [Session Tokens](#session-tokens)
- [Security Notes](#security-notes)

---

## Introduction and Overview

`merits` acts as the secure messaging and coordination layer of the **Kerits** ecosystem.  
It handles authenticated key management, encrypted messaging, and group collaboration through a CLI designed for both developers and test harness automation.

> **Note:** Merits does not depend on Kerits or KERI, but interoperates with them.  
> IDs may be any text string, though KERI AIDs are recommended for interoperability.

---

## Global Options

All commands support a `--format` option to control output format:

| Format | Description |
|---------|--------------|
| `json` *(default)* | Machine-readable JSON output |
| `pretty` | Indented, human-readable JSON |
| `raw` | Raw text or binary data, if applicable |

Example:
```bash
merits list-unread --token ${TOKEN} --format pretty
```

---

## User Management

User IDs (AIDs) and their public keys are controlled by the end user.  
A typical user lifecycle includes creating a key pair, registering it, authenticating via challenge–response, and rotating keys as needed.

### Creating a New Key-Pair

Users require cryptographic key-pairs for authentication.

```bash
# --seed is optional and allows deterministic key generation for testing
merits gen-key --seed 1234
```

This outputs a JSON object containing the private and public keys.

> ⚠️ **Important:** Keep your private key safe. Never share it or commit it to a repository.

---

### Creating a New User

Merits verifies ownership of a key-pair through a **challenge–response** ceremony.

```bash
# Step 1: Generate keys
merits gen-key > alice-keys.json
export PUBLIC_KEY=$(jq -r '.publicKey' alice-keys.json)
export USER_ID=$(jq -r '.aid' alice-keys.json)

# Step 2: Initiate challenge
merits create-user --id ${USER_ID} --public-key ${PUBLIC_KEY} > challenge.json

# Step 3: Sign the challenge
merits sign --file challenge.json --keys alice-keys.json > challenge-response.json

# Step 4: Confirm challenge and obtain a session token
merits confirm-challenge --file challenge-response.json > session-token.json
```

> Example: “alice” is a placeholder, not a valid SAID.

On success, a `session-token.json` is returned, which authenticates future operations.

---

### Logging In

The login flow mirrors `create-user`, but uses the existing ID:

```bash
merits sign-in --id alice > challenge.json
merits sign --file challenge.json --keys alice-keys.json > challenge-response.json
merits confirm-challenge --file challenge-response.json > session-token.json
```

Merits already knows the registered public key for `alice`; the signed challenge proves control of the private key.

---

### Updating Your Key Pair

When rotating keys (due to compromise or good practice), use:

```bash
merits gen-key > alice-keys-next.json
export NEW_PUBLIC_KEY=$(jq -r '.publicKey' alice-keys-next.json)

# Request rotation
merits rotate-key --token ${TOKEN} --public-key ${NEW_PUBLIC_KEY} > challenge.json

# Sign and confirm as before
merits sign --file challenge.json --keys alice-keys-next.json > challenge-response.json
merits confirm-challenge --file challenge-response.json > session-token.json
```

After success, future operations require the new key-pair.

---

## Sending Messages

Send plaintext messages using a recipient ID and session token:

```bash
merits send --to bob --token ${TOKEN} --type text --message "hi bob"
```

### Encrypting Messages

Messages should generally be encrypted to the recipient’s public key.

#### Manual Encryption

```bash
# Retrieve recipient’s public key
merits key-for --user bob --token ${TOKEN} > bobs-key.json

# Encrypt message manually
merits encrypt --public-key-file bobs-key.json --message "hi bob" > encrypted.json

# Send encrypted payload
merits send --to bob --token ${TOKEN} --type encrypted --message-data ./encrypted.json
```

#### Automatic Encryption

To simplify, use the `--encrypted` flag:

```bash
merits send --to bob --token ${TOKEN} --message "hi bob" --encrypted
```

Merits fetches the recipient’s public key and handles encryption automatically.

> **Permissions:** Sending requires that `bob` exists, `alice` has not been blocked, and messaging is permitted by group or policy rules.

---

## Listing Unread Messages

List unread message counts:

```bash
merits list-unread --token ${TOKEN}
```

Example output:
```json
{ "bob": 4, "joe": 2 }
```

Filter by sender:
```bash
merits list-unread --token ${TOKEN} --from bob,sue
```

---

## Receiving Messages

Retrieve unread messages:

```bash
merits unread --token ${TOKEN} > all-unread.json
merits unread --token ${TOKEN} --from bob > bob-unread.json
```

> ⚠️ **Important:**  
> Once marked as read, messages are **deleted** from the Merits server.  
> Ensure you’ve decrypted or stored them locally before acknowledging.

To stream incoming messages continuously:

```bash
merits unread --token ${TOKEN} --watch
```

---

## Marking Messages as Read

Mark messages as received (and delete them server-side):

```bash
merits extract-ids --file all-unread.json > message-ids.json
merits mark-as-read --token ${TOKEN} --ids-data ./message-ids.json
```

Or explicitly:

```bash
merits mark-as-read --token ${TOKEN} --ids abc,def
```

> The CLI automatically decrypts messages encrypted to your public key, including with prior keys after rotation.

---

## Groups

### Creating Groups

Authorized users can create new groups:

```bash
merits create-group --name my-group --members alice,bob,carol --token ${TOKEN} > new-group.json
```

Or from a JSON file:

```bash
merits create-group --name "another group" --member-list members.json --token ${TOKEN} > new-group.json
```

Group names are namespaced per creator; identical names from different users yield unique group IDs.

---

### How Secure Groups Work

1. **Key Conversion:**  
   Each Ed25519 key is converted to X25519 form for Diffie–Hellman.
2. **Shared Secret:**  
   Participants derive a shared secret using X25519 private/public key exchange.
3. **KDF:**  
   A Key Derivation Function (e.g., SHA-256) strengthens the shared secret into a symmetric key.
4. **Group Encryption:**  
   The initiator encrypts a randomly generated group key for each recipient using their derived secret.

> 🔐 Members can verify group integrity by re-deriving the shared secret using their own private key and the initiator’s public key.

---

### Messaging Groups

Send to a group by specifying its ID:

```bash
merits send --to <group-id> --token ${TOKEN} --message "team update" --encrypted
```

Group messages appear under `list-unread` and `unread`.

---

### Leaving Groups

```bash
merits leave --id <group-id> --token ${TOKEN}
```

---

## Controls

Control who can message you:

```bash
merits allow-list --add foo,bar --remove fizz --token ${TOKEN}
```

View your lists:

```bash
merits allow-list --list --token ${TOKEN} > my-controls.json
```

---

## Command Summary

| Category | Command | Purpose |
|-----------|----------|----------|
| Keys | `gen-key` | Generate a new key pair |
| Users | `create-user`, `sign-in`, `rotate-key` | Manage identity lifecycle |
| Messaging | `send`, `list-unread`, `unread`, `mark-as-read` | Send, read, or acknowledge messages |
| Groups | `create-group`, `leave` | Manage group communication |
| Controls | `allow-list` | Manage allow/deny lists |
| Utilities | `sign`, `encrypt`, `extract-ids` | Sign or process message data |

---

## Session Tokens

Session tokens are short-lived and bound to your current public key.  
They can be stored locally in `.merits/session.json` or passed explicitly with `--token`.

> **Note:** Future versions may automatically refresh tokens and support multiple profiles.

---

## Security Notes

- Merits never stores private keys — all signing occurs client-side.  
- Use air-gapped environments for high-security ceremonies.  
- Always back up keys securely before rotation.  
- Messages are ephemeral: once acknowledged, they are permanently deleted.

---

Merits CLI Specification v1.0
