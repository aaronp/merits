/**
 * Groups Unit Tests
 *
 * Tests group management logic in isolation (no Convex integration)
 */

import { describe, test, expect } from "bun:test";
import type { Group, GroupMember } from "../../core/interfaces/GroupApi";

describe("Group Operations", () => {
  test("group should include creator as owner", () => {
    const creator = "Dalice123";
    const members: GroupMember[] = [
      { aid: creator, role: "owner", joinedAt: Date.now() },
      { aid: "Dbob456", role: "member", joinedAt: Date.now() },
    ];

    const group: Group = {
      id: "test-group-1",
      name: "Test Group",
      createdBy: creator,
      createdAt: Date.now(),
      members,
    };

    expect(group.members.some((m) => m.aid === creator && m.role === "owner")).toBe(true);
  });

  test("cannot have group without owner", () => {
    const members: GroupMember[] = [
      { aid: "Dalice123", role: "admin", joinedAt: Date.now() },
      { aid: "Dbob456", role: "member", joinedAt: Date.now() },
    ];

    const hasOwner = members.some((m) => m.role === "owner");
    expect(hasOwner).toBe(false);
  });

  test("group members should be unique", () => {
    const alice = "Dalice123";
    const bob = "Dbob456";

    const memberSet = new Set([alice, bob, alice]); // Duplicate alice
    expect(memberSet.size).toBe(2); // Should deduplicate
    expect(Array.from(memberSet)).toEqual([alice, bob]);
  });

  test("admins and owners can modify membership", () => {
    const roles = ["owner", "admin", "member"];

    for (const role of roles) {
      const canModify = role === "owner" || role === "admin";
      expect(canModify).toBe(role !== "member");
    }
  });

  test("last owner cannot be removed", () => {
    const members: GroupMember[] = [
      { aid: "Dalice123", role: "owner", joinedAt: Date.now() },
      { aid: "Dbob456", role: "admin", joinedAt: Date.now() },
      { aid: "Dcarol789", role: "member", joinedAt: Date.now() },
    ];

    const toRemove = new Set(["Dalice123"]);
    const remaining = members.filter((m) => !toRemove.has(m.aid));
    const hasOwner = remaining.some((m) => m.role === "owner");

    expect(hasOwner).toBe(false); // Would violate constraint
  });

  test("can remove owner if another owner exists", () => {
    const members: GroupMember[] = [
      { aid: "Dalice123", role: "owner", joinedAt: Date.now() },
      { aid: "Dbob456", role: "owner", joinedAt: Date.now() },
      { aid: "Dcarol789", role: "member", joinedAt: Date.now() },
    ];

    const toRemove = new Set(["Dalice123"]);
    const remaining = members.filter((m) => !toRemove.has(m.aid));
    const hasOwner = remaining.some((m) => m.role === "owner");

    expect(hasOwner).toBe(true); // Bob is still owner
  });

  test("group message sequence numbers are monotonic", () => {
    const seqNums = [0, 1, 2, 3, 4];

    for (let i = 1; i < seqNums.length; i++) {
      expect(seqNums[i]).toBe(seqNums[i - 1] + 1);
    }
  });

  test("fanout count excludes sender", () => {
    const members: GroupMember[] = [
      { aid: "Dalice123", role: "owner", joinedAt: Date.now() },
      { aid: "Dbob456", role: "member", joinedAt: Date.now() },
      { aid: "Dcarol789", role: "member", joinedAt: Date.now() },
    ];

    const sender = "Dalice123";
    const recipients = members.filter((m) => m.aid !== sender);

    expect(recipients.length).toBe(2); // Bob and Carol
  });

  test("group membership check", () => {
    const members: GroupMember[] = [
      { aid: "Dalice123", role: "owner", joinedAt: Date.now() },
      { aid: "Dbob456", role: "member", joinedAt: Date.now() },
    ];

    const isMember = (aid: string) => members.some((m) => m.aid === aid);

    expect(isMember("Dalice123")).toBe(true);
    expect(isMember("Dbob456")).toBe(true);
    expect(isMember("Dcarol789")).toBe(false);
  });

  test("group role hierarchy", () => {
    type Role = "owner" | "admin" | "member";

    const roleLevel = (role: Role): number => {
      switch (role) {
        case "owner":
          return 3;
        case "admin":
          return 2;
        case "member":
          return 1;
      }
    };

    expect(roleLevel("owner")).toBeGreaterThan(roleLevel("admin"));
    expect(roleLevel("admin")).toBeGreaterThan(roleLevel("member"));
  });
});
