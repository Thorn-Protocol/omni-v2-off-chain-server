import { addresses } from "./common/config/config";
import { RPC_URL_BASE, TEST_EVM_KEY, TEST_SOLANA_KEY, TEST_V2_AGENT_ED25519_KEY, TEST_V2_AGENT_KEY, USDC_BASE_V2_AGENT_KEY } from "./common/config/secrets";
import { AaveV3UsdcStrategyOnBase } from "./services/Strategy/AaveV3UsdcStrategyOnBase";
import { AerodromeMsusdUsdcStrategyOnBase } from "./services/Strategy/AerodromeMsusdUsdcStrategyOnBase";
import { JupiterLendingUSDCOnBase } from "./services/Strategy/JupiterLendUSDCStrategyOnBase";

import OffChainVault from "./services/Vault/OffChainVault";

async function main() {
  //let test_JupiterLendUSDCStrategyOnBase = new JupiterLendingUSDCOnBase(TEST_EVM_KEY, TEST_SOLANA_KEY, 0.1, 3);

  let test_OffChainStrategyOnBase = new OffChainVault(addresses.test_vault.offChainStrategy, TEST_V2_AGENT_KEY, RPC_URL_BASE, "offchain strategy for TEST Vault on BASE");
  let test_AedromeMsusdUsdcStrategyOnBase = new AerodromeMsusdUsdcStrategyOnBase(TEST_V2_AGENT_KEY, 0.1, 3);
  let test_AaveV3UsdcStrategyOnBase = new AaveV3UsdcStrategyOnBase(TEST_V2_AGENT_KEY, 0.1, 3);
  let test_JupiterLendUSDCStrategyOnBase = new JupiterLendingUSDCOnBase(TEST_V2_AGENT_KEY, TEST_V2_AGENT_ED25519_KEY, 2, 2);
  test_OffChainStrategyOnBase.addStrategy(test_AedromeMsusdUsdcStrategyOnBase);
  test_OffChainStrategyOnBase.addStrategy(test_AaveV3UsdcStrategyOnBase);
  test_OffChainStrategyOnBase.addStrategy(test_JupiterLendUSDCStrategyOnBase);
  await test_OffChainStrategyOnBase.doEveryThing();
  // let usdcV2Base_OffChainStrategyOnBase = new OffChainVault(
  //   addresses.usdcV2OnBase.offChainStrategy,
  //   USDC_BASE_V2_AGENT_KEY,
  //   RPC_URL_BASE,
  //   "offchain strategy for USDC V2 BASE Vault on BASE"
  // );
  // let usdcV2Base_AaveV3UsdcStrategyOnBase = new AaveV3UsdcStrategyOnBase(USDC_BASE_V2_AGENT_KEY, 1, 7);
  // let usdcV2Base_AedromeMsusdUsdcStrategyOnBase = new AerodromeMsusdUsdcStrategyOnBase(USDC_BASE_V2_AGENT_KEY, 1, 7);
  // usdcV2Base_OffChainStrategyOnBase.addStrategy(usdcV2Base_AedromeMsusdUsdcStrategyOnBase);
  // usdcV2Base_OffChainStrategyOnBase.addStrategy(usdcV2Base_AaveV3UsdcStrategyOnBase);
  // await usdcV2Base_OffChainStrategyOnBase.doEveryThing();
}
main();
