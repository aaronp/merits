# Allow-List Controls Design

**Phase:** 6
**Status:** 🟡 In Progress
**Priority:** Medium

---

## Overview

Allow-list controls give users fine-grained control over who can send them messages. This feature implements both allow-lists (whitelists) and deny-lists (blacklists) with clear priority rules.

---

## Use Cases

1. **Block unwanted senders**
   - User can add senders to deny-list to block messages
   - Useful for spam prevention and harassment protection

2. **Private messaging**
   - User can enable allow-list mode (default-deny)
   - Only explicitly allowed senders can send messages
   - Useful for private/exclusive communication

3. **Temporary blocks**
   - User can temporarily block someone
   - Can unblock later by removing from deny-list

4. **Mixed mode**
   - User can have both allow-list and deny-list
   - Deny-list takes priority over allow-list

---

## Design Decisions

### List Types

**Allow-List (Whitelist)**
- When active (non-empty), only senders on this list can message the user
- Default: Inactive (all senders allowed)
- Activates when first AID is added

**Deny-List (Blacklist)**
- Senders on this list are always blocked
- Active regardless of allow-list state
- Takes priority over allow-list

### Priority Rules

```
if (sender in deny-list):
    BLOCK
elif (allow-list is active):
    if (sender in allow-list):
        ALLOW
    else:
        BLOCK
else:
    ALLOW  # Default: allow all
```

**Examples:**
- Empty lists → All messages allowed
- Deny-list: [alice] → Alice blocked, others allowed
- Allow-list: [bob, carol] → Only Bob and Carol allowed, others blocked
- Allow-list: [bob], Deny-list: [bob] → Bob blocked (deny wins)

### Storage Strategy

**Per-User Lists**
- Each user has their own allow-list and deny-list
- Lists are independent (Alice blocking Bob doesn't affect Bob blocking Alice)
- Lists stored as separate records for scalability

**Database Design**
```typescript
allowList: {
  ownerAid: string,      // User who owns this list
  allowedAid: string,    // AID that is allowed
  addedAt: number,       // Timestamp when added
  note: string?,         // Optional note
}

denyList: {
  ownerAid: string,      // User who owns this list
  deniedAid: string,     // AID that is denied
  addedAt: number,       // Timestamp when added
  reason: string?,       // Optional reason for blocking
}
```

---

## Schema Design

### New Tables

#### allowList
```typescript
allowList: defineTable({
  ownerAid: v.string(),    // User who owns this allow-list
  allowedAid: v.string(),  // AID that is explicitly allowed
  addedAt: v.number(),     // Timestamp when added
  note: v.optional(v.string()),  // Optional note (e.g., "work colleague")
})
  .index("by_owner", ["ownerAid"])
  .index("by_owner_allowed", ["ownerAid", "allowedAid"])
```

#### denyList
```typescript
denyList: defineTable({
  ownerAid: v.string(),    // User who owns this deny-list
  deniedAid: v.string(),   // AID that is explicitly denied
  addedAt: v.number(),     // Timestamp when added
  reason: v.optional(v.string()),  // Optional reason (e.g., "spam")
})
  .index("by_owner", ["ownerAid"])
  .index("by_owner_denied", ["ownerAid", "deniedAid"])
```

**Indexes:**
- `by_owner`: Fast lookup of all entries for a user
- `by_owner_allowed/denied`: Fast lookup to check if specific AID is in list

---

## Backend APIs

### List Management APIs

#### 1. `allowList.add()`
```typescript
mutation({
  args: {
    allowedAid: v.string(),
    note: v.optional(v.string()),
    auth: AuthProof,
  },
  handler: async (ctx, args) => {
    // Verify authentication
    const ownerAid = await verifyAuth(ctx, args.auth, "addToAllowList", {
      allowedAid: args.allowedAid,
    });

    // Check if already in list
    const existing = await ctx.db
      .query("allowList")
      .withIndex("by_owner_allowed", q =>
        q.eq("ownerAid", ownerAid).eq("allowedAid", args.allowedAid)
      )
      .first();

    if (existing) {
      return { id: existing._id, alreadyExists: true };
    }

    // Add to allow-list
    const id = await ctx.db.insert("allowList", {
      ownerAid,
      allowedAid: args.allowedAid,
      addedAt: Date.now(),
      note: args.note,
    });

    return { id, added: true };
  }
})
```

#### 2. `allowList.remove()`
```typescript
mutation({
  args: {
    allowedAid: v.string(),
    auth: AuthProof,
  },
  handler: async (ctx, args) => {
    const ownerAid = await verifyAuth(ctx, args.auth, "removeFromAllowList", {
      allowedAid: args.allowedAid,
    });

    const entry = await ctx.db
      .query("allowList")
      .withIndex("by_owner_allowed", q =>
        q.eq("ownerAid", ownerAid).eq("allowedAid", args.allowedAid)
      )
      .first();

    if (!entry) {
      throw new Error("AID not in allow-list");
    }

    await ctx.db.delete(entry._id);
    return { removed: true };
  }
})
```

#### 3. `allowList.list()`
```typescript
query({
  args: {
    ownerAid: v.string(),
  },
  handler: async (ctx, args) => {
    const entries = await ctx.db
      .query("allowList")
      .withIndex("by_owner", q => q.eq("ownerAid", args.ownerAid))
      .collect();

    return {
      allowList: entries.map(e => ({
        aid: e.allowedAid,
        addedAt: e.addedAt,
        note: e.note,
      })),
      isActive: entries.length > 0,
    };
  }
})
```

#### 4-6. Deny-list APIs (similar structure)
- `denyList.add()`
- `denyList.remove()`
- `denyList.list()`

#### 7. `allowList.clear()` - Remove all entries
#### 8. `denyList.clear()` - Remove all entries

### Access Control Helper

```typescript
/**
 * Check if sender is allowed to message recipient
 */
async function canMessage(
  ctx: DatabaseReader,
  senderAid: string,
  recipientAid: string
): Promise<{ allowed: boolean; reason?: string }> {
  // Check deny-list first (highest priority)
  const denied = await ctx.db
    .query("denyList")
    .withIndex("by_owner_denied", q =>
      q.eq("ownerAid", recipientAid).eq("deniedAid", senderAid)
    )
    .first();

  if (denied) {
    return { allowed: false, reason: "Sender is on deny-list" };
  }

  // Check if allow-list is active (has any entries)
  const allowListEntries = await ctx.db
    .query("allowList")
    .withIndex("by_owner", q => q.eq("ownerAid", recipientAid))
    .first();  // Just check if any exist

  if (!allowListEntries) {
    // Allow-list inactive, default to allow
    return { allowed: true };
  }

  // Allow-list active, check if sender is on it
  const allowed = await ctx.db
    .query("allowList")
    .withIndex("by_owner_allowed", q =>
      q.eq("ownerAid", recipientAid).eq("allowedAid", senderAid)
    )
    .first();

  if (allowed) {
    return { allowed: true };
  }

  return { allowed: false, reason: "Sender not on allow-list" };
}
```

---

## Integration Points

### 1. Direct Message Sending (`messages.send`)

**Before inserting message:**
```typescript
const access = await canMessage(ctx, senderAid, recipientAid);
if (!access.allowed) {
  throw new Error(`Cannot send message: ${access.reason}`);
}
```

### 2. Message Retrieval (`messages.getUnread`)

**Filter messages:**
```typescript
const messages = await ctx.db
  .query("messages")
  .withIndex("by_recipient", ...)
  .collect();

// Filter out messages from blocked senders
const filtered = [];
for (const msg of messages) {
  const access = await canMessage(ctx, msg.senderAid, recipientAid);
  if (access.allowed) {
    filtered.push(msg);
  }
}

return { messages: filtered };
```

**Note:** This is client-side filtering. For better performance, could add a background job to mark blocked messages.

### 3. Group Messages

**Individual filtering:**
- Allow/deny lists are per-user, not per-group
- When retrieving group messages, each user's deny-list is checked
- If sender is on user's deny-list, that specific user won't see the message
- Other group members still see it

**Example:**
- Alice, Bob, Carol in group
- Bob has denied Alice
- Alice sends group message
- Carol sees the message
- Bob does NOT see the message (filtered client-side)

---

## CLI Commands

### Allow-List Management

```bash
# Add to allow-list
merits allow-list add <aid> [--note "description"]

# Remove from allow-list
merits allow-list remove <aid>

# List current allow-list
merits allow-list list

# Clear entire allow-list (disable allow-list mode)
merits allow-list clear

# Show status
merits allow-list status
# Output: "Allow-list: ACTIVE (3 entries)" or "Allow-list: INACTIVE"
```

### Deny-List Management

```bash
# Add to deny-list (block someone)
merits deny-list add <aid> [--reason "spam"]

# Remove from deny-list (unblock someone)
merits deny-list remove <aid>

# List current deny-list
merits deny-list list

# Clear entire deny-list
merits deny-list clear

# Block shortcut
merits block <aid> [--reason "spam"]

# Unblock shortcut
merits unblock <aid>
```

---

## Security Considerations

### Privacy
- Allow/deny lists are private to each user
- No API to query another user's lists
- Backend enforces access control at message send time

### DoS Prevention
- Rate limit list additions (max 100 adds per hour)
- Maximum list size (1000 entries per list)
- Pagination for list retrieval

### Bypass Prevention
- Check performed server-side (cannot be bypassed by client)
- Applied to both direct and group messages
- Applies to all message types (text, files, etc.)

---

## Performance Considerations

### Database Queries
- Indexed lookups: O(log n) for membership check
- For each message send: 1-2 additional queries
- For message retrieval: O(m) where m = number of messages

### Optimization Strategies
1. **Cache allow-list status**
   - Cache whether allow-list is active
   - Invalidate on add/remove
   - Reduces queries when allow-list is inactive

2. **Batch checking**
   - When retrieving multiple messages, batch check senders
   - Reduces duplicate queries for same sender

3. **Background filtering**
   - Mark messages as "blocked" in database
   - Use cron job to periodically check and mark
   - Faster retrieval (just filter by flag)

---

## Migration Strategy

### Backward Compatibility
- New tables don't affect existing functionality
- Default behavior unchanged (allow all)
- Users opt-in by adding entries to lists

### Deployment
1. Deploy schema changes (add tables)
2. Deploy API changes (add mutations/queries)
3. Deploy CLI commands
4. No data migration needed (start with empty lists)

---

## Testing Strategy

### Unit Tests
- List management (add, remove, list, clear)
- Access control logic (priority rules)
- Edge cases (empty lists, both lists active, etc.)

### Integration Tests
1. **Allow-list mode**
   - User enables allow-list
   - Allowed sender can send
   - Non-allowed sender cannot send

2. **Deny-list mode**
   - User blocks sender
   - Blocked sender cannot send
   - Other senders can send

3. **Mixed mode**
   - User has both lists
   - Deny-list takes priority

4. **Group messages**
   - User blocks group member
   - User doesn't see blocked member's messages
   - Other members still see messages

### Performance Tests
- Large lists (1000 entries)
- Batch message retrieval with filtering
- Concurrent list modifications

---

## Future Enhancements

### Advanced Features
1. **Temporary blocks**
   - Add expiration timestamp to deny-list
   - Auto-remove after period

2. **Pattern matching**
   - Block all AIDs matching pattern
   - Useful for blocking entire organizations

3. **Shared lists**
   - Import/export lists
   - Community-maintained block lists

4. **Statistics**
   - Number of blocked messages
   - Most common blocked senders

5. **Mutual blocking**
   - If A blocks B, automatically suggest B blocks A
   - Privacy protection

---

## Success Criteria

✅ Users can add/remove AIDs from allow-list
✅ Users can add/remove AIDs from deny-list
✅ Denied senders cannot send messages
✅ Allow-list mode blocks non-allowed senders
✅ Priority rules correctly implemented
✅ Group messages respect individual deny-lists
✅ Performance impact < 10ms per message
✅ CLI commands are intuitive and documented

---

## Timeline

**Week 1:**
- Day 1-2: Schema design and backend APIs
- Day 3-4: Integration into message flow
- Day 5: Testing

**Week 2:**
- Day 1-2: CLI commands
- Day 3: Documentation
- Day 4-5: Integration testing and refinement

**Total:** ~2 weeks

---

## Next Steps

1. ✅ Design complete (this document)
2. Implement schema changes
3. Implement backend APIs
4. Integrate into message flow
5. Create CLI commands
6. Write tests
7. Update documentation

---

**Status:** 🟡 Design Complete - Ready for Implementation
**Last Updated:** 2025-11-01
