export const INTERVAL_TIME_REBALANCE = 6 * 60 * 60 * 1000; // 6 hours

export const MIN_DEPOSIT_WITHDRAW = 1;

export const addresses = {
  test_vault: {
    vault: "0x3eBBA4De3ff7221aaFd3863318C96E9f4dbCfBDE",
    offChainStrategy: "0xE049bdA7B0Ebb039C18671E13A65b4cfd6c8FaE5",
    strategy: {
      wasabi: "0x1C4a802FD6B591BB71dAA01D8335e43719048B24",
    },
  },
  usdcV2OnBase: {
    vault: "0x2669DfA1D91c1dF9fe51DEAC6E5369C7D43242a8",
    offChainStrategy: "0xD2a9dB8f22707166e82EdF89534340237780eDA3",
    strategy: {
      wasabi: "0x1C4a802FD6B591BB71dAA01D8335e43719048B24",
    },
  },
};
