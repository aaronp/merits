/**
 * Bootstrap Script
 * 
 * Runs the bootstrap mutation to initialize the merits system:
 * - Creates roles (admin, user, anon)
 * - Assigns permissions to roles
 * - Optionally assigns admin role to a specific AID
 * 
 * Usage:
 *   bun run scripts/bootstrap.ts [adminAid]
 * 
 * Or via Makefile:
 *   make bootstrap [adminAid=YOUR_AID]
 */

import { ConvexClient } from "convex/browser";
import { api } from "../convex/_generated/api";

const CONVEX_URL = process.env.CONVEX_URL;

if (!CONVEX_URL) {
  console.error("❌ Error: CONVEX_URL environment variable is required");
  console.error("   Please set it in your .env file or export it");
  process.exit(1);
}

async function bootstrap() {
  const adminAid = process.argv[2]; // Optional admin AID from command line

  const client = new ConvexClient(CONVEX_URL);

  try {
    console.log("🚀 Starting bootstrap...");
    if (adminAid) {
      console.log(`   Admin AID: ${adminAid}`);
    } else {
      console.log("   (No admin AID provided - roles will be created but no admin assigned)");
    }
    console.log(`   Convex URL: ${CONVEX_URL}`);
    console.log("");

    const result = await client.mutation(api.authorization_bootstrap.bootstrapOnboarding, {
      adminAid: adminAid || undefined,
    });

    console.log("✅ Bootstrap completed successfully!");
    console.log("");
    console.log("Results:");
    console.log(`  Message: ${result.message}`);
    console.log(`  Already initialized: ${result.already}`);
    console.log("");
    console.log("📝 Note: Check Convex logs for detailed permission assignment messages.");
    console.log("   Look for: 'Bootstrap: Linked user role to CAN_MESSAGE_USERS permission'");
    
    if (result.onboardingGroupId) {
      console.log(`  Onboarding Group ID: ${result.onboardingGroupId}`);
    }
    if (result.anonRoleId) {
      console.log(`  Anon Role ID: ${result.anonRoleId}`);
    }
    if (result.userRoleId) {
      console.log(`  User Role ID: ${result.userRoleId}`);
    }
    if (result.adminRoleId) {
      console.log(`  Admin Role ID: ${result.adminRoleId}`);
    }
    if (result.permissionId) {
      console.log(`  Permission ID: ${result.permissionId}`);
    }
    if (result.adminAid) {
      console.log(`  Admin AID assigned: ${result.adminAid}`);
    }

    console.log("");
    console.log("📋 Summary:");
    console.log("  - Roles created/verified: admin, user, anon");
    console.log("  - Permissions assigned:");
    console.log("    • 'user' role → CAN_MESSAGE_USERS (allows messaging any user)");
    console.log("    • 'admin' role → CAN_MESSAGE_USERS, CAN_CREATE_GROUPS, CAN_ASSIGN_ROLES");
    console.log("    • 'anon' role → CAN_MESSAGE_GROUPS (onboarding group only)");
    
    if (result.already) {
      console.log("");
      console.log("ℹ️  System was already initialized (idempotent operation)");
    }

  } catch (err: any) {
    console.error("");
    console.error("❌ Bootstrap error:", err.message);
    if (err.data) {
      console.error("   Error details:", JSON.stringify(err.data, null, 2));
    }
    process.exit(1);
  } finally {
    client.close();
  }
}

bootstrap();

