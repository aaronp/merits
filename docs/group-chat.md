# Group Chat System

## Overview

The MERITS group chat system provides a linear, persistent message history for group conversations with cryptographic governance through KERI KEL/TEL integration. Unlike traditional fan-out messaging systems, messages are stored in a single linear sequence within each group, eliminating duplication and simplifying synchronization.

## Architecture

### Database Schema

The group chat system uses three main tables:

#### GroupChats Table
Stores group metadata and governance information:
- `ownerAid`: The AID of the KERI KEL that owns this group
- `membershipSaid`: SAID reference to TEL membership data for governance
- `name`: Human-readable group name
- `maxTtl`: Maximum message retention period (for cleanup)
- `createdAt`: Group creation timestamp
- `createdBy`: AID that created the group

#### GroupMessages Table
Maintains linear message history:
- `groupChatId`: Foreign key to the group chat
- `encryptedMessage`: Encrypted message content
- `messageType`: Type classification (text, file, system, etc.)
- `senderAid`: AID of the message sender
- `seqNo`: Sequence number for strict ordering
- `received`: Server-side timestamp
- `expiresAt`: Optional expiration for automatic cleanup

#### GroupMembers Table
Tracks membership and synchronization state:
- `groupChatId`: Foreign key to the group chat
- `aid`: Member's AID
- `latestSeqNo`: Latest message sequence number this user has received
- `role`: Member role (owner, admin, member)
- `joinedAt`: Membership timestamp

## Key Features

### Linear Message History
Messages are stored in a single, ordered sequence within each group. Each message receives a monotonically increasing sequence number, ensuring strict ordering and eliminating race conditions.

### Synchronization Tracking
Each member maintains their own `latestSeqNo`, indicating the last message they've received. This enables:
- Efficient sync: Members can request only messages after their last known sequence
- Unread counts: The system can calculate unread messages as `totalMessages - (latestSeqNo + 1)`
- Resumable sync: Members can disconnect and resume from their last position

### KERI Integration
Groups are linked to KERI identity and governance systems:
- `ownerAid`: Links to the KEL that cryptographically owns the group
- `membershipSaid`: References TEL data for membership governance
- All operations require KERI signature verification

### No Fan-out Required
Unlike traditional group messaging that creates copies for each recipient, this design:
- Stores each message once in the group
- Members fetch messages directly from the group
- Reduces storage requirements by O(n) where n is member count
- Simplifies message ordering and consistency

## API Operations

### Creating a Group Chat

```typescript
const { groupChatId } = await createGroupChat({
  name: "Engineering Team",
  ownerAid: "EH7Oq9oxCgYa-bRn0RWSEP_2pZd9GgJMPrV5g4S3NEjw",
  membershipSaid: "SAID-membership-v1",
  maxTtl: 7 * 24 * 60 * 60 * 1000, // 7 days
  initialMembers: ["EI7AoW...", "EJ8BpX..."],
  auth: authProof
});
```

### Sending Messages

```typescript
const { messageId, seqNo } = await sendGroupMessage({
  groupChatId,
  encryptedMessage: "encrypted:Hello team!",
  messageType: "text",
  auth: authProof
});
```

### Retrieving Messages

```typescript
// Get all messages after sequence number 10
const messages = await getGroupMessages({
  groupChatId,
  afterSeqNo: 10,
  limit: 50,
  callerAid: "EH7Oq9..."
});
```

### Updating Sync State

```typescript
// Mark messages as read up to sequence 25
await updateMemberSync({
  groupChatId,
  latestSeqNo: 25,
  auth: authProof
});
```

### Managing Members

```typescript
// Add new members (requires admin/owner)
await addGroupMembers({
  groupChatId,
  members: ["EK9CqZ..."],
  auth: authProof
});

// Remove members (requires admin/owner)
await removeGroupMembers({
  groupChatId,
  members: ["EL0DrA..."],
  auth: authProof
});
```

### Updating Governance

```typescript
// Update TEL membership reference (owner only)
await updateMembershipSaid({
  groupChatId,
  membershipSaid: "SAID-membership-v2",
  auth: authProof
});
```

## Test Coverage

Comprehensive end-to-end tests are available in [tests/integration/group-chat.test.ts](../tests/integration/group-chat.test.ts).

✅ **All tests passing successfully!**

### Test Scenarios

1. **Group Creation**: Tests group creation with KERI governance links
2. **Linear Messaging**: Verifies sequential message ordering
3. **Sync Tracking**: Tests member synchronization and unread counts
4. **Member Management**: Tests adding/removing members with role-based permissions
5. **Governance Updates**: Tests updating membership SAID references
6. **Message Expiration**: Verifies TTL-based message retention
7. **Pagination**: Tests message retrieval with limits and offsets
8. **Multi-Group**: Tests handling multiple groups with independent message streams

## Benefits

### Simplified Architecture
- Single source of truth for message ordering
- No complex fan-out logic or race conditions
- Straightforward sync protocol

### Efficient Storage
- Each message stored once, regardless of group size
- Members fetch from shared history
- Reduces storage by factor of member count

### Strong Consistency
- Strict sequential ordering via sequence numbers
- Server-assigned timestamps prevent clock skew issues
- No message duplication or ordering conflicts

### Privacy and Security
- Messages remain encrypted with group keys
- KERI signatures verify all operations
- Governance changes tracked via TEL

### Flexible Sync
- Members can sync at their own pace
- Resumable from any point in history
- Efficient delta synchronization

## Implementation Notes

### Message Encryption
Messages should be encrypted with a group key before sending. The `encryptedMessage` field stores the ciphertext that all authorized members can decrypt with the shared group key.

### Sequence Number Assignment
The server assigns sequence numbers atomically when messages are inserted. This prevents race conditions and ensures global ordering within each group.

### Cleanup and Retention
The `maxTtl` field enables automatic message cleanup. A background job can periodically remove messages where `received + maxTtl < now()`.

### Member Permissions
- **Owner**: Can update membership SAID, add/remove members
- **Admin**: Can add/remove members (except owner)
- **Member**: Can send and receive messages

## Migration from Fan-out System

The previous fan-out system created individual message copies for each recipient. The new linear system:

1. Stores messages in a central group location
2. Eliminates the need for fan-out status tracking
3. Reduces storage requirements
4. Simplifies message ordering
5. Enables efficient synchronization

For migration:
1. Create new group chats with the same membership
2. Import historical messages with proper sequence numbers
3. Update clients to use the new sync-based protocol
4. Archive old fan-out tables once migration is complete

## Future Enhancements

- **Read Receipts**: Track which members have read each message
- **Reactions**: Add emoji reactions to messages
- **Threading**: Support reply threads within groups
- **Media Attachments**: Handle file uploads and media messages
- **Typing Indicators**: Show when members are typing
- **Message Editing**: Allow editing with history tracking
- **Search**: Full-text search within group history