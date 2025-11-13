import type { CLIContext } from '../lib/context';

export interface CreateUserOptions {
  aid: string;
  publicKey: string;
  _ctx: CLIContext;
}

export async function createUser(opts: CreateUserOptions): Promise<void> {
  const ctx = opts._ctx;
  const args = { aid: opts.aid, publicKey: opts.publicKey };
  // Use backend helper to issue challenge for registerUser
  const challenge = await ctx.client.identityAuth.issueChallenge({
    aid: opts.aid,
    purpose: 'registerUser' as any,
    args,
    ttlMs: 120000,
  });

  console.log(
    JSON.stringify(
      {
        challengeId: challenge.challengeId,
        payload: challenge.payloadToSign,
        purpose: 'registerUser',
        args,
        note: 'Sign payload canonical JSON with your key. Then run: merits sign-challenge --aid <aid> --publicKey <publicKey> --challenge-id <id> --sigs <idx-b64,idx-b64> --ksn <n>',
      },
      null,
      2,
    ),
  );
}
