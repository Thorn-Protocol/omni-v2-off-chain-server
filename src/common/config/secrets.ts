import dotenv from "dotenv";
import { ZeroAddress } from "ethers";
dotenv.config();

export const isProduction = process.env.IS_PRODUCT == "true";

export const isInRoflEnvironmental = process.env.IS_IN_ROFL == "true";

export const TEST_EVM_KEY = process.env.TEST_EVM_KEY ?? "7d6a5738f79262075f5df2597cb5a370916b55d3786abf37359e1baf62337ab3"; // random private key
export const TEST_SOLANA_KEY = process.env.TEST_SOLANA_KEY ?? "7d6a5738f79262075f5df2597cb5a370916b55d3786abf37359e1baf62337ab3"; // random private key
export const TEST_V2_AGENT_KEY = process.env.TEST_V2_AGENT_KEY ?? "7d6a5738f79262075f5df2597cb5a370916b55d3786abf37359e1baf62337ab3"; // random private key
export const TEST_V2_AGENT_ED25519_KEY = process.env.TEST_B2_AGENT_ED25519_KEY ?? "3Rg4NA9HufxoT9f75EZZFAsXkKNKHjk8uX2qwGeqpmejmaF5eVattCJ5GFtV5sDimt7uUAXcbzX2qt339sjRjRQk"; // random private key
export const USDC_BASE_V2_AGENT_KEY = process.env.USDC_BASE_V2_AGENT_KEY ?? "7d6a5738f79262075f5df2597cb5a370916b55d3786abf37359e1baf62337ab3"; // random private key
export const USDC_BASE_V2_AGENT_ED25519_KEY =
  process.env.USDC_BASE_V2_AGENT_ED25519_KEY ?? "3Rg4NA9HufxoT9f75EZZFAsXkKNKHjk8uX2qwGeqpmejmaF5eVattCJ5GFtV5sDimt7uUAXcbzX2qt339sjRjRQk"; // random private key
export const RPC_URL_BASE = process.env.RPC_URL_BASE ?? "https://base.llamarpc.com";
// telegram
export const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
export const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
