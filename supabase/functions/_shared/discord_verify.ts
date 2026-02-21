/**
 * Verifies that an incoming request genuinely comes from Discord.
 * Discord signs every interaction with Ed25519 using the app's public key.
 * Reference: https://discord.com/developers/docs/interactions/receiving-and-responding#security-and-authorization
 */
export async function verifyDiscordSignature(
  publicKeyHex: string,
  signature: string,
  timestamp: string,
  rawBody: string,
): Promise<boolean> {
  try {
    const publicKeyBytes = hexToUint8Array(publicKeyHex);
    const signatureBytes = hexToUint8Array(signature);
    const message = new TextEncoder().encode(timestamp + rawBody);

    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      publicKeyBytes,
      { name: "Ed25519" },
      false,
      ["verify"],
    );

    return await crypto.subtle.verify("Ed25519", cryptoKey, signatureBytes, message);
  } catch {
    return false;
  }
}

function hexToUint8Array(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("Invalid hex string length");
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}
