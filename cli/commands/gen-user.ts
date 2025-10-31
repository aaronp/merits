import type { CLIContext } from "../lib/context";
import { generateKeyPair } from "../../core/crypto";
import { createAID } from "../../core/crypto";

export interface GenUserOptions {
  _ctx: CLIContext;
}

export async function genUser(opts: GenUserOptions): Promise<void> {
  const keys = await generateKeyPair();
  const aid = createAID(keys.publicKey);
  const out = {
    aid,
    publicKey: Buffer.from(keys.publicKey).toString("base64url"),
    secretKey: Buffer.from(keys.privateKey).toString("base64url"),
  };
  console.log(JSON.stringify(out, null, 2));
}


