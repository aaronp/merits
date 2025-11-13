/**
 * Convex Transport Client
 *
 * Clean interface for KERI message transport over Convex.
 * Export all types and implementations.
 */

export { ConvexTransport, registerKeyState } from './convex-transport';
export type {
  // Core types
  AID,
  Bytes,
  Challenge,
  ChallengeResponse,
  Channel,
  KeyStateRegistration,
  // Message types
  Message,
  SAID,
  Signature,
  // Authentication
  Signer,
  // Transport interface
  Transport,
  TransportConfig,
} from './types';
