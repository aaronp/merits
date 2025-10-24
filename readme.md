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

Transport Implementaton:
 * Admins can't see the encrypted contents, but just the information they need for delivery.
 * The server can keep data in order to rate-limit accounts and maintain simple "Access Controls" to define who 

