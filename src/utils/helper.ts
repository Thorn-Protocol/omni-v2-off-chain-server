import { JsonRpcProvider } from "ethers";
import { RPC_URL_BASE, TEST_V2_AGENT_KEY, USDC_BASE_V2_AGENT_KEY } from "../common/config/secrets";

let base_rpc = new JsonRpcProvider(RPC_URL_BASE);

import { ethers } from "ethers";

export const ROLES = {
  GOVERNANCE_MANAGER: ethers.keccak256(ethers.toUtf8Bytes("ROLE_GOVERNANCE_MANAGER")),
  ADD_STRATEGY_MANAGER: ethers.keccak256(ethers.toUtf8Bytes("ROLE_ADD_STRATEGY_MANAGER")),
  REVOKE_STRATEGY_MANAGER: ethers.keccak256(ethers.toUtf8Bytes("ROLE_REVOKE_STRATEGY_MANAGER")),
  ACCOUNTANT_MANAGER: ethers.keccak256(ethers.toUtf8Bytes("ROLE_ACCOUNTANT_MANAGER")),
  QUEUE_MANAGER: ethers.keccak256(ethers.toUtf8Bytes("ROLE_ACCOUNTANT_MANAGER")),
  REPORTING_MANAGER: ethers.keccak256(ethers.toUtf8Bytes("ROLE_REPORTING_MANAGER")),
  DEBT_MANAGER: ethers.keccak256(ethers.toUtf8Bytes("ROLE_DEBT_MANAGER")),
  MAX_DEBT_MANAGER: ethers.keccak256(ethers.toUtf8Bytes("ROLE_MAX_DEBT_MANAGER")),
  DEPOSIT_LIMIT_MANAGER: ethers.keccak256(ethers.toUtf8Bytes("ROLE_DEPOSIT_LIMIT_MANAGER")),
  WITHDRAW_LIMIT_MANAGER: ethers.keccak256(ethers.toUtf8Bytes("ROLE_WITHDRAW_LIMIT_MANAGER")),
  MINIMUM_IDLE_MANAGER: ethers.keccak256(ethers.toUtf8Bytes("ROLE_MINIMUM_IDLE_MANAGER")),
  PROFIT_UNLOCK_MANAGER: ethers.keccak256(ethers.toUtf8Bytes("ROLE_PROFIT_UNLOCK_MANAGER")),
  DEBT_PURCHASER: ethers.keccak256(ethers.toUtf8Bytes("ROLE_DEBT_PURCHASER")),
  EMERGENCY_MANAGER: ethers.keccak256(ethers.toUtf8Bytes("ROLE_EMERGENCY_MANAGER")),
};

export function getProvider(chainId: string) {
  if (chainId == "8453") {
    return base_rpc;
  }
  throw Error(`Chain ${chainId} not supported`);
}

export function getAgentFromCode(code: string) {
  if (code == "usdc-base-v2") {
    return USDC_BASE_V2_AGENT_KEY;
  }
  if (code == "test-v2") {
    return TEST_V2_AGENT_KEY;
  }
  throw Error(`Agent for code ${code} not found`);
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getTimestampNow() {
  return Math.floor(Date.now() / 1000);
}
