import { addresses } from "./common/config/config";
import {
  RPC_URL_BASE,
  TEST_EVM_KEY,
  TEST_SOLANA_KEY,
  USDC_BASE_V2_AGENT_ED25519_KEY,
  USDC_BASE_V2_AGENT_KEY,
  isInRoflEnvironmental,
} from "./common/config/secrets";
import { AaveV3UsdcStrategyOnBase } from "./services/Strategy/AaveV3UsdcStrategyOnBase";
import { AerodromeMsusdUsdcStrategyOnBase } from "./services/Strategy/AerodromeMsusdUsdcStrategyOnBase";
import { JupiterLendingUSDCOnBase } from "./services/Strategy/JupiterLendUSDCStrategyOnBase";

import OffChainVault from "./services/Vault/OffChainVault";
import { getAgentKey } from "./utils/helper";

interface SetupOffChainStrategyProps {
  code: "test-v2" | "usdc-base-v2";
  vaultAddress: string;
  providerUrl: string;
  name: string;
  strategies: {
    aedromeMsusdUsdc: {
      enabled: boolean;
      minDebt: number;
      maxDebt: number;
    };
    aaveV3Usdc: {
      enabled: boolean;
      minDebt: number;
      maxDebt: number;
    };
    jupiterLendUsdc: {
      enabled: boolean;
      minDebt: number;
      maxDebt: number;
    };
  };
}

async function setupOffChainStrategy({
  code,
  vaultAddress,
  providerUrl,
  name,
  strategies,
}: SetupOffChainStrategyProps) {
  let secp256k1Key = await getAgentKey(code, "secp256k1");
  let ed25519Key = await getAgentKey(code, "ed25519");

  let offChainStrategy = new OffChainVault(vaultAddress, secp256k1Key, providerUrl, name);

  let agentRegistered = await offChainStrategy.getAddressAgentRegistered();
  console.log(`Address agent registered: ${agentRegistered}`);
  let agentController = await offChainStrategy.getAddressAgentController();
  console.log(`Address agent controller: ${agentController}`);

  if (agentRegistered != agentController) {
    console.error(`Agent registered: ${agentRegistered} is not the same as agent controller: ${agentController}`);
    throw new Error(`Agent registered: ${agentRegistered} is not the same as agent controller: ${agentController}`);
  }

  if (strategies.aedromeMsusdUsdc.enabled) {
    let aedromeMsusdUsdcStrategy = new AerodromeMsusdUsdcStrategyOnBase(
      secp256k1Key,
      strategies.aedromeMsusdUsdc.minDebt,
      strategies.aedromeMsusdUsdc.maxDebt
    );
    offChainStrategy.addStrategy(aedromeMsusdUsdcStrategy);
  }
  if (strategies.aaveV3Usdc.enabled) {
    let aaveV3UsdcStrategy = new AaveV3UsdcStrategyOnBase(
      secp256k1Key,
      strategies.aaveV3Usdc.minDebt,
      strategies.aaveV3Usdc.maxDebt
    );
    offChainStrategy.addStrategy(aaveV3UsdcStrategy);
  }
  if (strategies.jupiterLendUsdc.enabled) {
    let jupiterLendUsdcStrategy = new JupiterLendingUSDCOnBase(
      secp256k1Key,
      ed25519Key,
      strategies.jupiterLendUsdc.minDebt,
      strategies.jupiterLendUsdc.maxDebt
    );
    offChainStrategy.addStrategy(jupiterLendUsdcStrategy);
  }

  return offChainStrategy;
}

async function main() {
  if (isInRoflEnvironmental) {
    console.log(` ROFL Config: isInRoflEnvironmental: ${isInRoflEnvironmental}`);
  }

  let test_OffChainStrategyOnBase = await setupOffChainStrategy({
    code: "test-v2",
    vaultAddress: addresses.test_vault.offChainStrategy,
    providerUrl: RPC_URL_BASE,
    name: "offchain strategy for TEST Vault on BASE",
    strategies: {
      aedromeMsusdUsdc: { enabled: true, minDebt: 1, maxDebt: 3 },
      aaveV3Usdc: { enabled: true, minDebt: 1, maxDebt: 100 },
      jupiterLendUsdc: { enabled: true, minDebt: 2, maxDebt: 3 },
    },
  });

  //await test_OffChainStrategyOnBase.autoRebalance();

  // let usdcV2Base_OffChainStrategyOnBase = await setupOffChainStrategy({
  //   code: "usdc-base-v2",
  //   vaultAddress: addresses.usdcV2OnBase.offChainStrategy,
  //   providerUrl: RPC_URL_BASE,
  //   name: "offchain strategy for USDC V2 BASE Vault on BASE",
  //   strategies: {
  //     aedromeMsusdUsdc: { enabled: true, minDebt: 1, maxDebt: 3 },
  //     aaveV3Usdc: { enabled: true, minDebt: 1, maxDebt: 100 },
  //     jupiterLendUsdc: { enabled: true, minDebt: 5, maxDebt: 10 },
  //   },
  // });
  // await usdcV2Base_OffChainStrategyOnBase.autoRebalance();
}
main();
