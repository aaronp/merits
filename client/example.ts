/**
 * Example usage of ConvexTransport
 *
 * Demonstrates:
 * - Key state registration
 * - Creating transport
 * - Sending/receiving messages
 * - WebSocket subscriptions
 */

import { ConvexTransport, registerKeyState } from './index';
import type { Signer, Message } from './index';

// ========== Mock Signer (replace with actual KERI implementation) ==========

class MockSigner implements Signer {
  constructor(
    private privateKey: Uint8Array,
    private publicKey: string
  ) {}

  async sign(data: Uint8Array): Promise<string> {
    // TODO: Replace with actual CESR signing
    // For now, just mock it
    const signature = new Uint8Array(64);
    crypto.getRandomValues(signature);
    return 'EA' + Buffer.from(signature).toString('base64');
  }

  verifier(): string {
    return this.publicKey;
  }
}

// ========== Example ==========

async function example() {
  const convexUrl = 'https://accurate-penguin-901.convex.cloud';

  // Alice's credentials
  const aliceAid = 'EAlice...';
  const aliceSigner = new MockSigner(
    new Uint8Array(32), // private key
    'DAliceVerifier...' // public key (CESR)
  );

  // Bob's credentials
  const bobAid = 'EBob...';
  const bobSigner = new MockSigner(
    new Uint8Array(32),
    'DBobVerifier...'
  );

  // Step 1: Register key states (one-time setup)
  console.log('Registering key states...');
  await registerKeyState(convexUrl, {
    aid: aliceAid,
    ksn: 0,
    verfer: aliceSigner.verifier(),
    estEventSaid: 'EAliceInceptionEvent...',
    signer: aliceSigner,
  });

  await registerKeyState(convexUrl, {
    aid: bobAid,
    ksn: 0,
    verfer: bobSigner.verifier(),
    estEventSaid: 'EBobInceptionEvent...',
    signer: bobSigner,
  });

  // Step 2: Create transports
  console.log('Creating transports...');
  const aliceTransport = new ConvexTransport({
    convexUrl,
    aid: aliceAid,
    signer: aliceSigner,
    ksn: 0,
    estEventSaid: 'EAliceInceptionEvent...',
  });

  const bobTransport = new ConvexTransport({
    convexUrl,
    aid: bobAid,
    signer: bobSigner,
    ksn: 0,
    estEventSaid: 'EBobInceptionEvent...',
  });

  // Step 3: Bob subscribes to messages
  console.log('Bob subscribing to messages...');
  const bobChannel = bobTransport.channel(bobAid);
  const unsubscribe = bobChannel.subscribe((msg: Message) => {
    console.log('Bob received:', {
      from: msg.from,
      typ: msg.typ,
      body: new TextDecoder().decode(msg.body),
    });
  });

  // Step 4: Alice sends message to Bob
  console.log('Alice sending message to Bob...');
  const encoder = new TextEncoder();
  const messageId = await aliceTransport.send({
    from: aliceAid,
    to: bobAid,
    typ: 'app.message',
    body: encoder.encode(JSON.stringify({ text: 'Hello Bob!' })),
    dt: new Date().toISOString(),
  });
  console.log('Message sent:', messageId);

  // Step 5: Bob polls for unread messages (alternative to subscription)
  await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait for delivery
  console.log('Bob checking unread...');
  const unread = await bobTransport.readUnread(bobAid);
  console.log('Unread messages:', unread.length);

  // Step 6: Bob acknowledges messages
  if (unread.length > 0) {
    console.log('Bob acknowledging messages...');
    await bobTransport.ack(
      bobAid,
      unread.map((m) => m.id)
    );
    console.log('Acknowledged:', unread.length, 'messages');
  }

  // Step 7: Cleanup
  console.log('Cleaning up...');
  unsubscribe();
  aliceTransport.close();
  bobTransport.close();

  console.log('Done!');
}

// Run example
if (import.meta.main) {
  example().catch(console.error);
}
