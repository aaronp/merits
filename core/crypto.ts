import * as ed from "@noble/ed25519";

export interface KeyPair {
    publicKey: Uint8Array; // 32 bytes
    privateKey: Uint8Array; // 32 bytes
}

export async function generateKeyPair(): Promise<KeyPair> {
    const privateKey = getRandomPrivateKey();
    const publicKey = await ed.getPublicKeyAsync(privateKey);
    return { publicKey, privateKey };
}

export async function sign(
    message: Uint8Array,
    privateKey: Uint8Array
): Promise<Uint8Array> {
    return await ed.signAsync(message, privateKey);
}

export async function verify(
    signature: Uint8Array,
    message: Uint8Array,
    publicKey: Uint8Array
): Promise<boolean> {
    try {
        return await ed.verifyAsync(signature, message, publicKey);
    } catch {
        return false;
    }
}

export function createAID(publicKey: Uint8Array): string {
    // Simplified KERI-style AID: 'D' prefix + base64url(publicKey)
    return `D${uint8ArrayToBase64Url(publicKey)}`;
}

export function uint8ArrayToBase64Url(bytes: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function getRandomPrivateKey(): Uint8Array {
    const buf = new Uint8Array(32);
    // Use Web Crypto if available
    if (typeof globalThis !== "undefined" && (globalThis as any).crypto?.getRandomValues) {
        (globalThis as any).crypto.getRandomValues(buf);
        return buf;
    }
    // Fallback to Math.random (not cryptographically strong, but tests only)
    for (let i = 0; i < buf.length; i++) {
        buf[i] = Math.floor(Math.random() * 256);
    }
    return buf;
}


