/**
 * Convex Transport Client
 *
 * Clean interface for KERI message transport over Convex.
 * Export all types and implementations.
 */

export type {
  // Core types
  AID,
  SAID,
  Bytes,

  // Message types
  Message,
  Signature,

  // Transport interface
  Transport,
  TransportConfig,
  Channel,

  // Authentication
  Signer,
  KeyStateRegistration,
  Challenge,
  ChallengeResponse,
} from './types';

export { ConvexTransport, registerKeyState } from './convex-transport';
