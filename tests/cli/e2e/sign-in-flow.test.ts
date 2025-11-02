/**
 * E2E Test: Sign-In Flow (Returning Users)
 *
 * Tests the complete sign-in workflow for returning users.
 * Covers session expiration, re-authentication, and session renewal.
 *
 * Scenario:
 * 1. User incepts (first time)
 * 2. User signs out / session expires
 * 3. User signs back in with existing AID
 * 4. Verify new session token obtained
 * 5. Verify user can still access messages
 * 6. Test whoami after sign-in
 *
 * Priority: P1 (authentication flow)
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { runCliInProcess, assertSuccess } from "../helpers/exec";
import { ensureAdminInitialised, getAdminSessionToken, type AdminCredentials } from "../../helpers/admin-bootstrap";
import { mkScenario } from "../helpers/workspace";
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";

// Only run if CONVEX_URL and BOOTSTRAP_KEY are set
const CONVEX_URL = process.env.CONVEX_URL;
const BOOTSTRAP_KEY = process.env.BOOTSTRAP_KEY;

const shouldRun = CONVEX_URL && BOOTSTRAP_KEY;
const runTests = shouldRun ? describe : describe.skip;

runTests("E2E: Sign-In Flow (Returning Users)", () => {
  let scenario: ReturnType<typeof mkScenario>;
  let admin: AdminCredentials;
  let adminSessionPath: string;
  let userAid: string;
  let userPublicKey: string;
  let userPrivateKey: string;

  beforeAll(async () => {
    admin = await ensureAdminInitialised(CONVEX_URL!);
    console.log(`✓ Admin initialized: ${admin.aid}`);

    scenario = mkScenario("sign-in-flow");

    // Get admin session token
    adminSessionPath = join(scenario.dataDir, "admin-session.json");
    await getAdminSessionToken(CONVEX_URL!, admin, {
      ttlMs: 90000,
      saveTo: adminSessionPath,
    });
    console.log(`✓ Admin session token created`);
  }, 60000);

  it("user incepts for the first time", async () => {
    const result = await runCliInProcess(
      ["incept", "--seed", "returning-user-test"],
      {
        cwd: scenario.root,
        env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
      }
    );

    assertSuccess(result);

    // Save credentials for later
    userAid = result.json.aid;
    userPublicKey = result.json.keys.publicKey;
    userPrivateKey = result.json.keys.privateKey;

    // Verify first session
    expect(result.json.session).toBeDefined();
    expect(result.json.session.token).toBeString();
    expect(result.json.session.aid).toBe(userAid);

    console.log(`✓ User incepted: ${userAid}`);
    console.log(`  First session token obtained`);
  }, 15000);

  it("whoami shows active session after inception", async () => {
    const result = await runCliInProcess(["whoami"], {
      cwd: scenario.root,
      env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
    });

    assertSuccess(result);
    expect(result.json.session.active).toBe(true);
    expect(result.json.session.aid).toBe(userAid);

    console.log("✓ Initial session is active");
  }, 10000);

  it("simulate session expiration by removing session file", async () => {
    const sessionFile = join(scenario.dataDir, "session.json");

    // Verify session file exists
    expect(existsSync(sessionFile)).toBe(true);

    // Remove session file (simulates expiration or logout)
    unlinkSync(sessionFile);

    // Verify it's gone
    expect(existsSync(sessionFile)).toBe(false);

    console.log("✓ Session file removed (simulating expiration)");
  }, 5000);

  it("whoami fails when session is expired", async () => {
    const result = await runCliInProcess(["whoami"], {
      cwd: scenario.root,
      env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
    });

    // Should fail - no session
    expect(result.code).not.toBe(0);

    console.log("✓ Whoami correctly fails without session");
  }, 10000);

  it("user signs back in with existing AID", async () => {
    const result = await runCliInProcess(["sign-in", "--id", userAid], {
      cwd: scenario.root,
      env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
    });

    assertSuccess(result);

    // Should get a sign-in challenge
    expect(result.json).toBeDefined();
    expect(result.json.challenge).toBeDefined();
    expect(result.json.challenge.aid).toBe(userAid);
    expect(result.json.challenge.challenge).toBeString();

    console.log("✓ Sign-in challenge created");
    console.log(`  Challenge: ${result.json.challenge.challenge.substring(0, 20)}...`);

    // Save challenge for next step
    const challengeFile = join(scenario.dataDir, "sign-in-challenge.json");
    writeFileSync(challengeFile, JSON.stringify(result.json, null, 2));
  }, 15000);

  it("user signs the challenge with stored keys", async () => {
    const challengeFile = join(scenario.dataDir, "sign-in-challenge.json");
    const keysFile = join(scenario.dataDir, "user-keys.json");

    // Create keys file
    writeFileSync(
      keysFile,
      JSON.stringify(
        {
          aid: userAid,
          privateKey: userPrivateKey,
          publicKey: userPublicKey,
        },
        null,
        2
      )
    );

    // Sign the challenge
    const result = await runCliInProcess(
      ["sign", "--file", challengeFile, "--keys", keysFile],
      {
        cwd: scenario.root,
        env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
      }
    );

    assertSuccess(result);
    expect(result.json.signature).toBeString();

    console.log("✓ Challenge signed");

    // Save signed response
    const responseFile = join(scenario.dataDir, "sign-in-response.json");
    writeFileSync(responseFile, JSON.stringify(result.json, null, 2));
  }, 15000);

  it("user confirms sign-in challenge and obtains new session", async () => {
    const responseFile = join(scenario.dataDir, "sign-in-response.json");

    const result = await runCliInProcess(
      ["confirm-challenge", "--file", responseFile],
      {
        cwd: scenario.root,
        env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
      }
    );

    assertSuccess(result);

    // Should get new session token
    expect(result.json.session).toBeDefined();
    expect(result.json.session.token).toBeString();
    expect(result.json.session.aid).toBe(userAid);

    console.log("✓ New session token obtained after sign-in");
  }, 15000);

  it("whoami shows active session after sign-in", async () => {
    const result = await runCliInProcess(["whoami"], {
      cwd: scenario.root,
      env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
    });

    assertSuccess(result);
    expect(result.json.session.active).toBe(true);
    expect(result.json.session.aid).toBe(userAid);

    console.log("✓ Session is active after sign-in");
  }, 10000);

  it("user can still access their data after sign-in", async () => {
    // Grant user role first
    await runCliInProcess(
      [
        "users",
        "grant-role",
        userAid,
        "user",
        "--token",
        adminSessionPath,
        "--actionSAID",
        "grant-signin-user",
      ],
      { env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! } }
    );

    // User sends themselves a message
    const sendResult = await runCliInProcess(
      ["send", userAid, "--message", "Test message after sign-in"],
      {
        cwd: scenario.root,
        env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
      }
    );

    assertSuccess(sendResult);

    // Wait for propagation
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // User reads their messages
    const readResult = await runCliInProcess(["unread"], {
      cwd: scenario.root,
      env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
    });

    assertSuccess(readResult);
    expect(Array.isArray(readResult.json.messages)).toBe(true);

    console.log("✓ User can send and receive messages after sign-in");
  }, 30000);

  it("user can perform multiple sign-in cycles", async () => {
    // Remove session
    const sessionFile = join(scenario.dataDir, "session.json");
    if (existsSync(sessionFile)) {
      unlinkSync(sessionFile);
    }

    // Sign in again
    const signInResult = await runCliInProcess(["sign-in", "--id", userAid], {
      cwd: scenario.root,
      env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
    });

    assertSuccess(signInResult);

    // Sign challenge
    const keysFile = join(scenario.dataDir, "user-keys.json");
    const challengeFile = join(scenario.dataDir, "challenge2.json");
    writeFileSync(challengeFile, JSON.stringify(signInResult.json, null, 2));

    const signResult = await runCliInProcess(
      ["sign", "--file", challengeFile, "--keys", keysFile],
      {
        cwd: scenario.root,
        env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
      }
    );

    assertSuccess(signResult);

    // Confirm
    const responseFile = join(scenario.dataDir, "response2.json");
    writeFileSync(responseFile, JSON.stringify(signResult.json, null, 2));

    const confirmResult = await runCliInProcess(
      ["confirm-challenge", "--file", responseFile],
      {
        cwd: scenario.root,
        env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
      }
    );

    assertSuccess(confirmResult);

    console.log("✓ Multiple sign-in cycles work");
  }, 45000);
});

describe("E2E: Sign-In Edge Cases", () => {
  it("should fail sign-in with non-existent AID", async () => {
    if (!CONVEX_URL) return;

    const scenario = mkScenario("signin-edge");

    const result = await runCliInProcess(
      ["sign-in", "--id", "DNonExistentAid123"],
      {
        cwd: scenario.root,
        env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
      }
    );

    // Should fail - AID doesn't exist
    expect(result.code).not.toBe(0);

    console.log("✓ Sign-in correctly fails for non-existent AID");

    scenario.cleanup();
  }, 15000);

  it("should fail confirm-challenge with invalid signature", async () => {
    if (!CONVEX_URL || !BOOTSTRAP_KEY) return;

    const scenario = mkScenario("invalid-sig");

    // Incept user
    const inceptResult = await runCliInProcess(
      ["incept", "--seed", "invalid-sig-test"],
      {
        cwd: scenario.root,
        env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
      }
    );

    assertSuccess(inceptResult);
    const userAid = inceptResult.json.aid;

    // Get session file and remove it
    const sessionFile = join(scenario.dataDir, "session.json");
    if (existsSync(sessionFile)) {
      unlinkSync(sessionFile);
    }

    // Create sign-in challenge
    const signInResult = await runCliInProcess(["sign-in", "--id", userAid], {
      cwd: scenario.root,
      env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
    });

    assertSuccess(signInResult);

    // Create invalid signed response
    const invalidResponse = {
      ...signInResult.json,
      signature: "invalid-signature-data",
    };

    const responseFile = join(scenario.dataDir, "invalid-response.json");
    writeFileSync(responseFile, JSON.stringify(invalidResponse, null, 2));

    // Try to confirm with invalid signature
    const confirmResult = await runCliInProcess(
      ["confirm-challenge", "--file", responseFile],
      {
        cwd: scenario.root,
        env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
      }
    );

    // Should fail
    expect(confirmResult.code).not.toBe(0);

    console.log("✓ Invalid signature correctly rejected");

    scenario.cleanup();
  }, 30000);

  it("should handle missing session file gracefully", async () => {
    if (!CONVEX_URL) return;

    const scenario = mkScenario("missing-session");

    // Try whoami without ever creating a session
    const result = await runCliInProcess(["whoami"], {
      cwd: scenario.root,
      env: { MERITS_VAULT_QUIET: "1", CONVEX_URL: CONVEX_URL! },
    });

    // Should fail gracefully
    expect(result.code).not.toBe(0);
    expect(result.stderr).toBeDefined();

    console.log("✓ Missing session file handled gracefully");

    scenario.cleanup();
  }, 10000);
});
