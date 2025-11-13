/**
 * Quick test to verify bootstrap idempotency
 * Should return {already: true} since database has data
 */

import { ConvexClient } from 'convex/browser';
import { api } from './convex/_generated/api';

const CONVEX_URL = process.env.CONVEX_URL!;

async function testBootstrapIdempotency() {
  const client = new ConvexClient(CONVEX_URL);

  try {
    console.log('Testing bootstrap on non-empty database...');

    const result = await client.mutation(api.authorization_bootstrap.bootstrapOnboarding, {
      adminAid: 'TEST_AID_12345',
    });

    console.log('\nBootstrap result:');
    console.log(JSON.stringify(result, null, 2));

    if (result.already === true) {
      console.log('\n✅ SUCCESS: Bootstrap correctly detected existing data');
      console.log(`   Message: ${result.message}`);
      console.log(`   Admin Role ID: ${result.adminRoleId}`);
      console.log(`   User Role ID: ${result.userRoleId}`);
      console.log(`   Anon Role ID: ${result.anonRoleId}`);
    } else {
      console.log('\n❌ FAIL: Bootstrap should have returned already:true');
      process.exit(1);
    }
  } catch (err: any) {
    console.error('\n❌ Bootstrap error:', err.message);
    process.exit(1);
  } finally {
    client.close();
  }
}

testBootstrapIdempotency();
