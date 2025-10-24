# Merits Convex - KERI-Authenticated Message Bus

A secure message bus with KERI-style challenge/response authentication system.

This project declares the API surface for a secure peer-to-peer messaging and group messaging,
as well as a concrete implementation built using Convex.

## Project Goals:

Transport API:
 * To define a simple reactive Transport API for sending and receiving messages between two user Ids (AIDs)
 * To use Ed25519 signatures for encrypting messages (e.g. message encryiption with recipient's public key) and authentication (proving the sender holds the private key for their userId)
 * Recipients can only read messages for their own IDs, which they've proven they hold the private keys for (e.g. there is a userId : publicKey mapping). Ed25519 key pairs may change over time, but the userIds will be stable
 * The API represents a persistent message buffer for recipients to either "read unread" or use a 'onMessage(message)' subscription mechanism
 * The intent is that receipients are responsible for the persistent storage, so the messages can be assumed to be deleted when marked as read

Group API:
 * There should be a GroupApi, which may be able to use an underlying Transport API in its implementation, to support sending messages to groups. 
 * Groups should just be modeled with a unique groupId against a set of memberIds (which will thus also be able to model groups of groups)
 * It's assumed the implementation will be able to model this by using metadata alongside direct messages (e.g. Alice sends a message to Bob encrypted with his public key, but with metadata which says "this is a message I'm sending to use as part of group ABC")
 * The metadata mechanism should be generic enough to support various group dynamics (e.g. a group which might use a RAFT-like mechanism to determine the group history), but equally the server implementation can help with practical scalability issues, such as allowing senders to send messages to a 'group', and the server can then encode individual messages with the recipients public keys and enque them in those recipients mailboxes. The server can then also itself impose a 'group message ordering' consistent for all participants.
 

Transport Implementaton:
 * Admins can't see the encrypted contents, but just the information they need for delivery.
 * The server can keep data in order to rate-limit accounts and maintain simple "Access Controls" which allow users as well as admins to restrict/block who can send what to whom
 * The implementation can keep data on usage for admins to be able to see aggregate data, such as how many messages were sent and consumed, and other metadata about message timestamps so as to support the platform (but without being able to see the encoded message bodies, but could see the message metadata)
 
 ## Use-Case

 New users can create and verify (via challenge/response) their own IDs and public-key mappings.
 This auth should be sympathetic to how KERI does challenge response to verify ownership of an Id (AID).

 The result of first registry is for new users to be in an 'unknown' group, which is a group containing the new AID and the AIDS of specified admins.

 Those people can then message each other, and admins can asign a 'role' to the new AID user which governs their rate-limits, access, etc.

 Those new users can also manage their own ACLs (e.g. block unwanted senders)


## Interface-based client

Use `createMeritsClient` to access the portable interfaces implemented by Convex adapters.

```ts
import { createMeritsClient } from "./src/client";

const CONVEX_URL = process.env.CONVEX_URL!;
const merits = createMeritsClient(CONVEX_URL);

// Identity auth: issue a challenge bound to args
const challenge = await merits.identity.issueChallenge({
  aid: aliceAid,
  purpose: "send",
  args: { recpAid: bobAid, ctHash, ttl: 60000, alg: "", ek: "" },
});

// Transport: send, receive, ack
await merits.transport.sendMessage({
  to: bobAid,
  ct: ciphertext,
  typ: "chat.text.v1",
  ttlMs: 60000,
  auth: { challengeId: challenge.challengeId, sigs, ksn: 0 },
});

const messages = await merits.transport.receiveMessages({
  for: bobAid,
  auth: bobReceiveAuth,
});

// Groups
await merits.group.createGroup({
  name: "Project Team",
  initialMembers: [aliceAid, bobAid],
  auth: manageGroupAuth,
});

merits.close();
```

Legacy `MessageBusClient` remains available for backwards compatibility.

