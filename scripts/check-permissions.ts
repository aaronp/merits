/**
 * Check Permissions Script
 *
 * Verifies that the 'user' role has the CAN_MESSAGE_USERS permission.
 *
 * Usage:
 *   bun run scripts/check-permissions.ts
 */

import { ConvexClient } from 'convex/browser';
import { api } from '../convex/_generated/api';

const CONVEX_URL = process.env.CONVEX_URL;

if (!CONVEX_URL) {
  console.error('❌ Error: CONVEX_URL environment variable is required');
  process.exit(1);
}

async function checkPermissions() {
  const client = new ConvexClient(CONVEX_URL);

  try {
    console.log('🔍 Checking permissions...');
    console.log(`   Convex URL: ${CONVEX_URL}`);
    console.log('');

    // Get the user role
    const roles = await client.query(api.testHelpers.getAllRoles, {});
    const userRole = roles.find((r: any) => r.roleName === 'user');

    if (!userRole) {
      console.error('❌ User role not found!');
      process.exit(1);
    }

    console.log(`✅ Found user role: ${userRole._id}`);
    console.log('');

    // Get all permissions for the user role
    const rolePermissions = await client.query(api.testHelpers.getRolePermissions, {
      roleId: userRole._id,
    });

    console.log(`📋 Permissions for 'user' role (${rolePermissions.length} total):`);
    for (const rp of rolePermissions) {
      console.log(`   - ${rp.permission.key}`);
      if (rp.permission.key === 'can.message.users') {
        console.log(`     ✅ CAN_MESSAGE_USERS permission is assigned!`);
      }
    }
    console.log('');

    const hasCanMessageUsers = rolePermissions.some((rp: any) => rp.permission.key === 'can.message.users');

    if (hasCanMessageUsers) {
      console.log("✅ SUCCESS: 'user' role has CAN_MESSAGE_USERS permission");
    } else {
      console.log("❌ ERROR: 'user' role does NOT have CAN_MESSAGE_USERS permission");
      console.log("   Run 'make bootstrap' to assign it.");
      process.exit(1);
    }
  } catch (err: any) {
    console.error('');
    console.error('❌ Error:', err.message);
    if (err.data) {
      console.error('   Error details:', JSON.stringify(err.data, null, 2));
    }
    process.exit(1);
  } finally {
    client.close();
  }
}

checkPermissions();
