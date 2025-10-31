# CLI

`merits` is the application entry point, built via `make compile`.



# User Management

User Ids (AIDs) and their public keys are specified and controlled by the end user.

Users can use any ID they choose, but they should be the AID generated from incepting a new kerits identity.


*Note:*
```
There is no dependency on kerits from merits, however, and the ID is simply plain text.

If you don't use a keri AID, however, the only thing new users can do is message the onboarding team,
who will want to verify your KERI AID, and so using other IDs (such as a UUID) is of little use.

Still, it's great for testing scenarios in demo environments.
```

## Creating a new key-pair

Users in merits require cryptographic key-pairs for authentication.

For users who which to use merits outside of keri or kerits, you can create a new ED25519 key pair like this:

```sh
# --seed is an optional entropy value, used to create idempotent keys
merits gen-key --seed 1234
```

This will output a new private and public keys in json format.

You can pipe this to a file, write it down, etc. 

** Note: ** Keep it safe if you're going to use it for anything important!

## Creating new user

The Merits server needs to know you control the private key for a key-pair. It does this through a challenge-response mechanism, where upon creating new users, the server asks the new client to sign some random challenge with their private key, and then submit that challenge back to the server to prove they are the owner of the public key.

```sh

# from step 1, creating a new key:
merits gen-key >  alice-keys.json

export PUBLIC_KEY=$(jq -r '.publicKey' alice-keys.json)

# initialiate the challenge. The output is the challenge sent from the server. Here we save it in a 'challenge.json' file.
# the challenge response contains the userId, a random 'nonce' value, and the public key submitted.
merits create-user -id alice -publicKey ${PUBLIC_KEY} > challenge.json

# sign the challenge. here we show it saved to a file
merits sign -file challenge.json -keys alice-keys.json > challenge-response.json

# submit the challenge response:
merits confirm-challenge -file challenge-response.json > session-token.json

```

Note: "alice" is not a valid SAID, but is used here as an example.

If a user with the Id 'alice' already existed, or we took too long to submit the challenge response, or our signature was invalid, then the `confirm-challenge` would fail with a non-zero exit code and error message

On success, it returns a session token we can use for subsequent actions

## Logging in

The log-in flow looks similar to the 'create-user' flow in that we need to complete a challenge. Instead of `merits create-user`, however, we use `sign-in` with the userId like this:
```sh
merits sign-in -id alice > challenge.json

# sign the challenge. here we show it saved to a file
merits sign -file challenge.json -keys alice-keys.json > challenge-response.json

# submit the challenge response:
merits confirm-challenge -file challenge-response.json > session-token.json
```

Merits already knows the public key for 'alice', and here we prove we have the private key.

## Updating your key pair

If your key pair is compromised (or you just practice regular key rotation as a security practice), you will want to update the public key merits has on record.

This flow goes through a similar challenge process, but requires an authenticated session token:

```sh
merits gen-key >  alice-keys-next.json
export NEW_PUBLIC_KEY=$(jq -r '.publicKey' alice-keys-next.json)

# we assume TOKEN is an env variable set with the value from `merits confirm-challenge`
merits rotate-key -token ${TOKEN} -publicKey ${NEW_PUBLIC_KEY}

# sign the challenge. here we show it saved to a file
merits sign -file challenge.json -keys alice-keys-next.json > challenge-response.json

# submit the challenge response:
merits confirm-challenge -file challenge-response.json > session-token.json
```

On success, the merits server will now use the new key-pair to authenticate the 'alice' user

# Sending Messages

We can send plain text simply by specifying a recipient ID, our session token from authenticating, and the type and message

```sh
# type is optional
merits send -to bob -token ${TOKEN} --type 'text' -message 'hi bob'
```

We don't want our un-encrypted data on the merits server, however, so we should encrypt our message to bob with Bob's public key (so bob can read it)

We could do manually ourselves by asking merits for Bob's public key:
```sh
# save the public key on file for bob against bobsKey.json, again, authenticating with our ${TOKEN}
merits key-for -user bob -token ${TOKEN} >  bobsKey.json

# use bob's public key in bobsKey.json to encrypt a message using our own tools
```

Or we can just use `merits encrypt` as a convenience to do that for us
```sh
merits encrypt -user bob -token ${TOKEN} -message 'hi bob' > encryptedMessageToBob.json
```

And now send bob the encrypted message:
```sh
merits send -to bob -token ${TOKEN} --type 'encrypted' -messageData ./encryptedMessageToBob.json

# we could also send it all in one line with -message rather than -messageData like this:
export MSG=`cat ./encryptedMessageToBob.json`
merits send -to bob -token ${TOKEN} --type 'encrypted' -messageData ${MSG}
```

We can also save on that two-step process using the -encrypted flag:
```sh
merits send -to bob -token ${TOKEN} -message 'hi bob' -encrypted
```

That simply performs the steps for us above automatically

**Note**:
Merits manages groups, permissions and rate limits. All the above assumes that bob exists, has not blocked alice, and alice has the requisite permissions to message bob

# Listing Messages

To receive messages, we can use 'list-unread' to get a summary of the userIDs and counts of messages we have yet to receive:

```sh
## returns a json response of userIds to their unread count. e.g. { "bob" : 4, "joe" : 4 }
merits list-unread -token ${TOKEN}
```

We can ask for unread from one or more specific users:
```sh
## returns a json response of userIds to their unread count. e.g. { "bob" : 4 }
merits list-unread -token ${TOKEN} -from bob,sue

# in this example, sue may not be included, as she may not exist, or may not have any unread messages from sue
```

# Receiving Messages

By design, merits only keeps data as long as it takes for the recipient to acknowledge that they've received it.

```sh
## returns a json response of message payloads for all users 
merits unread -token ${TOKEN} > allUnread.json

## returns a json response of message payloads from specific users
merits unread -token ${TOKEN} -from bob > bobUnread.json
```

Now that we've saved the messages locally, we can tell merits to mark them as read, which (!!!!) deletes them on the merits server (so be sure you've finished processing, or otherwise backed them up first!)


To continue to watch for new messages, you can specify the `--watch` flag, which keeps the connection open and streams the incoming messages to standard output:

```sh
merits unread -token ${TOKEN} -from bob --watch
```

# Marking messages as read
```sh
## convenience function for getting a json array of the messageIds
merits extract-ids -file allUnread.json > messageIds.json

##  marks the messages as read
merits mark-as-read -token ${TOKEN} -idsData ./messageIds.json

# we can also explicitly specify individual Ids as a comma-separated list
merits mark-as-read -token ${TOKEN} -ids abc,def

```

## Note: message data is likely encrypted with your public key.
The Merits CLI will automatically decrypte 'encrypted' message types with your public key.
The received messages also contain 'publicKey' fields which specify the public key with which they were encrypted.
This allows you to decrypt messages sent with your previous keys (keys you had before rotating them)


# Groups

## Creating Groups

If you've been granted permission to create groups (you have that role), you can create new groups to message.

```sh
merits create-group -name my-group -members alice,bob,carol -token ${TOKEN} > newGroupId1.json

# or alternatively from a json list of member Ids:
merits create-group -name "another group" -memberList members.json -token ${TOKEN} > newGroupId2.json
```

Group names are namespaced to the creator, so the same group name created by different users will not collide, as both will have unique group IDs

The group is created on the merits server, and sends (or tries to send, subject to recipient permissions) a message to all members with a json payload encoded with the recipients' public keys. That payload contains the groupId, group name, and member list of the userIds and public keys.


### Detail: How Secure Groups works

1. Key Conversion: Your Ed25519 private key is converted into an X25519 private key. Similarly, the other person's Ed25519 public key is converted into an X25519 public key.

2. Shared Secret Derivation: You use your X25519 private key and their X25519 public key to perform a Diffie-Hellman key exchange operation. This operation securely derives a shared secret that both parties can calculate independently, but which a third party cannot determine from the public keys alone.

3. Symmetric Key Generation: The resulting shared secret is a raw value. You should run this value through a Key Derivation Function (KDF), such as a hash function (e.g., SHA-256 or similar), to produce the final, robust symmetric key for encryption (e.g., for AES or ChaCha20-Poly1305).

4. Group Messaging: For secure group messaging, this pairwise key exchange forms the basis. The group initiator generates an ephemeral (single-use) key pair, derive a unique shared secret with each recipient, and use those secrets to securely transmit a single group symmetric key (which was randomly generated) to all members.

Summary of the process for two people:
 * Alice (You) has an Ed25519 key pair (Priv_A, Pub_A) and converts them to X25519 keys (XPriv_A, XPub_A).
 * Bob has an Ed25519 key pair (Priv_B, Pub_B) and converts them to X25519 keys (XPriv_B, XPub_B).
 * Alice and Bob exchange their public keys (Pub_A and Pub_B, or directly XPub_A and XPub_B).
 * Alice computes SharedSecret = ECDH(XPriv_A, XPub_B).
 * Bob computes SharedSecret = ECDH(XPriv_B, XPub_A).
 * Both end up with the same SharedSecret.
 * They then apply a KDF to SharedSecret to get the final symmetric key.


## Messaging Groups

Messaging groups behaves the same as messaging an individual - you simply specify the groupId as the '-to' recipient, and the group appears in the `list-unread` operation

## Leaving Groups

Any member can leave a group using the `leave` command:

```sh
merits leave -id group-id -token ${TOKEN}
```

# Controls

You can avoid spam by updating your "allow-list" and "deny-list":

```sh
merits allow-list -add foo,bar -remove fizz -token ${TOKEN}
```

You can check your current allow or deny list with the `-list` option:
```sh
merits allow-list -list -token ${TOKEN} > myControls.json
```