/**
 * Formatter Tests
 *
 * Tests for output formatters with snapshot tests.
 */

import { describe, test, expect } from "bun:test";
import {
  formatMessages,
  formatIdentity,
  formatGroup,
  type EncryptedMessage,
} from "../../../cli/lib/formatters";

describe("Message Formatters", () => {
  const sampleMessages: EncryptedMessage[] = [
    {
      id: "msg-123",
      from: "EABCDEFabcdef1234567890",
      to: "EXYZabcdef9876543210",
      ct: "aGVsbG8gd29ybGQ=",
      typ: "chat.text.v1",
      ttlMs: 60000,
      createdAt: 1700000000000,
      sig: ["0-abc123def456"],
      ksn: 0,
    },
    {
      id: "msg-456",
      from: "EXYZabcdef9876543210",
      to: "EABCDEFabcdef1234567890",
      ct: "Z29vZGJ5ZSB3b3JsZA==",
      typ: "chat.text.v1",
      ek: "EKephemeral123",
      alg: "ECDH-ES+A256GCM",
      ttlMs: 60000,
      createdAt: 1700001000000,
      sig: ["0-xyz789ghi012"],
      ksn: 1,
    },
  ];

  test("formats as JSON (minimal)", async () => {
    const output = await formatMessages(sampleMessages, "json", {
      verbose: false,
    });

    expect(output).toMatchSnapshot();
  });

  test("formats as JSON (verbose)", async () => {
    const output = await formatMessages(sampleMessages, "json", {
      verbose: true,
    });

    expect(output).toMatchSnapshot();
  });

  test("formats as text (no color)", async () => {
    const output = await formatMessages(sampleMessages, "text", {
      color: false,
    });

    expect(output).toMatchSnapshot();
  });

  test("formats as text (verbose, no color)", async () => {
    const output = await formatMessages(sampleMessages, "text", {
      verbose: true,
      color: false,
    });

    expect(output).toMatchSnapshot();
  });

  test("formats as compact (no color)", async () => {
    const output = await formatMessages(sampleMessages, "compact", {
      color: false,
    });

    expect(output).toMatchSnapshot();
  });

  test("throws error for unknown format", async () => {
    await expect(
      formatMessages(sampleMessages, "xml" as any, {})
    ).rejects.toThrow("Unknown format");
  });

  test("handles empty message array", async () => {
    const output = await formatMessages([], "json", {});
    expect(output).toBe("[]");
  });
});

describe("Identity Formatter", () => {
  const sampleIdentity = {
    aid: "EABCDEFabcdef1234567890",
    ksn: 0,
    metadata: {
      email: "alice@example.com",
      createdAt: 1700000000000,
    },
  };

  test("formats identity as JSON", async () => {
    const output = await formatIdentity(
      "alice",
      sampleIdentity,
      "json",
      {}
    );

    expect(output).toMatchSnapshot();
  });

  test("formats identity as text (no color)", async () => {
    const output = await formatIdentity(
      "alice",
      sampleIdentity,
      "text",
      { color: false }
    );

    expect(output).toMatchSnapshot();
  });

  test("formats identity as text (verbose, no color)", async () => {
    const output = await formatIdentity(
      "alice",
      sampleIdentity,
      "text",
      { verbose: true, color: false }
    );

    expect(output).toMatchSnapshot();
  });

  test("formats identity as compact", async () => {
    const output = await formatIdentity(
      "alice",
      sampleIdentity,
      "compact",
      {}
    );

    expect(output).toMatchSnapshot();
  });
});

describe("Group Formatter", () => {
  const sampleGroup = {
    id: "grp-123",
    name: "Test Group",
    members: [
      "EABCDEFabcdef1234567890",
      "EXYZabcdef9876543210",
      "E123456789abcdef",
    ],
    createdAt: 1700000000000,
  };

  test("formats group as JSON", async () => {
    const output = await formatGroup(sampleGroup, "json", {});
    expect(output).toMatchSnapshot();
  });

  test("formats group as text (no color)", async () => {
    const output = await formatGroup(sampleGroup, "text", { color: false });
    expect(output).toMatchSnapshot();
  });

  test("formats group as text (verbose, no color)", async () => {
    const output = await formatGroup(sampleGroup, "text", {
      verbose: true,
      color: false,
    });
    expect(output).toMatchSnapshot();
  });

  test("formats group as compact", async () => {
    const output = await formatGroup(sampleGroup, "compact", {});
    expect(output).toMatchSnapshot();
  });
});
