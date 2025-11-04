// solana-keygen.ts
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

/**
 * Generate a random Solana Keypair and return multiple representations.
 */
/**
 * Generate a random Solana keypair and return it in multiple formats
 * @returns Object containing keypair, publicKey, secretKey in various formats
 */
export function generateSolanaKeypair() {
  // Generate a new random keypair using secure random number generation
  const keypair = Keypair.generate();

  // Extract the secret key as Uint8Array (64 bytes: 32 secret + 32 public)
  const secretKey = keypair.secretKey;

  // Get public key as base58 string
  const publicKey = keypair.publicKey.toBase58();

  // Encode secret key to base58 for easy storage/reading
  const secretKeyBase58 = bs58.encode(secretKey);

  // Convert secret key to hex format (optional)
  const secretKeyHex = Buffer.from(secretKey).toString("hex");

  return {
    keypair, // Original Keypair object (can be used directly as signer)
    publicKey, // Base58 string
    secretKey, // Uint8Array (64 bytes)
    secretKeyBase58, // Base58 string
    secretKeyHex, // Hex string
  };
}
generateSolanaKeypair();

export function loadKeypairFromBase58(base58Secret: string): Keypair {
  const secretKey = bs58.decode(base58Secret);
  return Keypair.fromSecretKey(secretKey);
}
