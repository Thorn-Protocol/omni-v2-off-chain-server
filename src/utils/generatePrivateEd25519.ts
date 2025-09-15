// solana-keygen.ts
import { Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

/**
 * Tạo một Keypair Solana ngẫu nhiên và trả về nhiều dạng biểu diễn.
 */
export function generateSolanaKeypair() {
  // Keypair.generate() dùng crypto secure RNG
  const keypair = Keypair.generate();

  // secretKey là Uint8Array (64 bytes: secret + public)
  const secretKey = keypair.secretKey; // Uint8Array

  // publicKey dạng string
  const publicKey = keypair.publicKey.toBase58();

  // secretKey encode sang base58 (dễ lưu/đọc)
  const secretKeyBase58 = bs58.encode(secretKey);

  // secretKey sang hex (tùy thích)
  const secretKeyHex = Buffer.from(secretKey).toString("hex");
  console.log(secretKeyBase58);
  return {
    keypair, // nguyên object Keypair (có thể dùng trực tiếp làm signer)
    publicKey, // chuỗi base58
    secretKey, // Uint8Array (64 bytes)
    secretKeyBase58, // chuỗi base58
    secretKeyHex, // chuỗi hex
  };
}
generateSolanaKeypair();

/**
 * Ví dụ: phục hồi Keypair từ secretKey base58
 */
export function loadKeypairFromBase58(base58Secret: string): Keypair {
  const secretKey = bs58.decode(base58Secret);
  return Keypair.fromSecretKey(secretKey);
}
