/**
 * Development Utilities
 *
 * ⚠️  WARNING: These functions are for DEVELOPMENT ONLY
 * They should NEVER be used in production.
 */

import { mutation } from "./_generated/server";

/**
 * Clear all data from the database
 *
 * ⚠️  DANGER: This deletes ALL data from ALL tables!
 * Only use in development environments.
 */
export const clearAllData = mutation({
  args: {},
  handler: async (ctx) => {
    // Security check: Only allow in dev with BOOTSTRAP_KEY set
    const BOOTSTRAP_KEY = process.env.BOOTSTRAP_KEY;
    if (!BOOTSTRAP_KEY) {
      throw new Error(
        "CLEAR_DB_DISABLED - Database clearing is not available in this environment. " +
        "For dev setup, set BOOTSTRAP_KEY environment variable."
      );
    }

    // Get all tables
    const tables = [
      "challenges",
      "users",
      "keyStates",
      "roles",
      "userRoles",
      "rolePermissions",
      "permissions",
      "groupChats",
      "groupMembers",
      "messages",
      "authChallenges",
      "usedNonces",
    ];

    let totalDeleted = 0;

    for (const tableName of tables) {
      try {
        // Get all documents in the table
        const docs = await ctx.db.query(tableName as any).collect();

        // Delete each document
        for (const doc of docs) {
          await ctx.db.delete(doc._id);
          totalDeleted++;
        }

        console.log(`Cleared ${docs.length} documents from ${tableName}`);
      } catch (err) {
        // Table might not exist, skip it
        console.log(`Skipping table ${tableName}: ${err}`);
      }
    }

    console.log(`✅ Database cleared: ${totalDeleted} total documents deleted`);

    return {
      success: true,
      tablesCleared: tables.length,
      documentsDeleted: totalDeleted,
      message: `Cleared ${totalDeleted} documents from ${tables.length} tables`,
    };
  },
});
