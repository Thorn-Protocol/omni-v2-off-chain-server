import dotenv from "dotenv";
import { ZeroAddress } from "ethers";
dotenv.config();

export const isProduction = process.env.IS_PRODUCT == "true";

export const TEST_V2_AGENT_KEY = process.env.TEST_V2_AGENT_KEY ?? "7d6a5738f79262075f5df2597cb5a370916b55d3786abf37359e1baf62337ab3"; // random private key

export const USDC_BASE_V2_AGENT_KEY = process.env.USDC_BASE_V2_AGENT_KEY ?? "7d6a5738f79262075f5df2597cb5a370916b55d3786abf37359e1baf62337ab3"; // random private key

export const RPC_URL_BASE = process.env.RPC_URL_BASE ?? "https://base.llamarpc.com";

// telegram

export const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
export const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
