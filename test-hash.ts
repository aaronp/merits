import { computeArgsHash } from './core/crypto';

const args1 = { aid: 'DC8-1K1AoLnGJ-7f-D_acNTMDD5DnID7_jIdWwm9lGI8', publicKey: 'test-key' };
const args2 = { scopes: ['admin'], ttlMs: 60000 };

console.log('Args1:', JSON.stringify(args1, Object.keys(args1).sort()));
console.log('Hash1:', computeArgsHash(args1));

console.log('\nArgs2:', JSON.stringify(args2, Object.keys(args2).sort()));
console.log('Hash2:', computeArgsHash(args2));
