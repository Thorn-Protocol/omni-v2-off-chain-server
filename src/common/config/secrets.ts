import dotenv from "dotenv";
import { ZeroAddress } from "ethers";
dotenv.config();

export const isProduction = process.env.IS_PRODUCT == "true";

export const isInRoflEnvironmental = process.env.IS_IN_ROFL == "true";

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing environment variable: ${key}`);
  }
  return value;
}

export const TEST_EVM_KEY = requireEnv("TEST_EVM_KEY");
export const TEST_SOLANA_KEY = requireEnv("TEST_SOLANA_KEY");
export const TEST_V2_AGENT_KEY = requireEnv("TEST_V2_AGENT_KEY");
export const TEST_V2_AGENT_ED25519_KEY = requireEnv("TEST_V2_AGENT_ED25519_KEY");
export const USDC_BASE_V2_AGENT_KEY = requireEnv("USDC_BASE_V2_AGENT_KEY");
export const USDC_BASE_V2_AGENT_ED25519_KEY = requireEnv("USDC_BASE_V2_AGENT_ED25519_KEY");
export const RPC_URL_BASE = process.env.RPC_URL_BASE ?? "https://base.llamarpc.com";
// telegram
export const TELEGRAM_BOT_TOKEN = requireEnv("TELEGRAM_BOT_TOKEN");
export const TELEGRAM_CHAT_ID = requireEnv("TELEGRAM_CHAT_ID");
