import { JsonRpcProvider } from "ethers";
import {
  isInRoflEnvironmental,
  RPC_URL_BASE,
  TEST_V2_AGENT_ED25519_KEY,
  TEST_V2_AGENT_KEY,
  USDC_BASE_V2_AGENT_ED25519_KEY,
  USDC_BASE_V2_AGENT_KEY,
} from "../common/config/secrets";
import { ethers } from "ethers";
import { ROFL } from "../services/RoflService/RoflService";

let base_rpc = new JsonRpcProvider(RPC_URL_BASE);

export function getProvider(chainId: string) {
  if (chainId == "8453") {
    return base_rpc;
  }
  throw Error(`Chain ${chainId} not supported`);
}

export function getAgentKey(code: "test-v2" | "usdc-base-v2", type: "secp256k1" | "ed25519") {
  if (isInRoflEnvironmental) {
    return ROFL.getKey(code, type);
  }
  if (code == "usdc-base-v2" && type == "secp256k1") {
    return USDC_BASE_V2_AGENT_KEY;
  }
  if (code == "usdc-base-v2" && type == "ed25519") {
    return USDC_BASE_V2_AGENT_ED25519_KEY;
  }
  if (code == "test-v2" && type == "secp256k1") {
    return TEST_V2_AGENT_KEY;
  }
  if (code == "test-v2" && type == "ed25519") {
    return TEST_V2_AGENT_ED25519_KEY;
  }
  throw Error(`Agent for code ${code} not found`);
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getTimestampNow() {
  return Math.floor(Date.now() / 1000);
}
