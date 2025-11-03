import dotenv from "dotenv";
import { ZeroAddress } from "ethers";
dotenv.config();

export const isProduction = process.env.IS_PRODUCT == "true";

export const isInRoflEnvironmental = process.env.IS_IN_ROFL == "true";

export const TEST_EVM_KEY = process.env.TEST_EVM_KEY ?? "";
export const TEST_SOLANA_KEY = process.env.TEST_SOLANA_KEY ?? "";
export const TEST_V2_AGENT_KEY = process.env.TEST_V2_AGENT_KEY ?? "";
export const TEST_V2_AGENT_ED25519_KEY = process.env.TEST_V2_AGENT_ED25519_KEY ?? "";
export const USDC_BASE_V2_AGENT_KEY = process.env.USDC_BASE_V2_AGENT_KEY ?? "";
export const USDC_BASE_V2_AGENT_ED25519_KEY = process.env.USDC_BASE_V2_AGENT_ED25519_KEY ?? "";
export const RPC_URL_BASE = process.env.RPC_URL_BASE ?? "https://base.llamarpc.com";
// telegram
export const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
export const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? "";
