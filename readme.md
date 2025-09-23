<h1> OmniFarming V2 Agent ROFL </h1>

This repo hosts the source code that runs the OmniFarming Agent that controls the off-chain strategy.

- [Overview](#overview)
- [ROFL](#rofl)
- [Stategies integrated](#strategies-intergrated)

## Overview

Agent has the function of withdrawing/depositing money, calculating asset allocation into strategies for the best apy, and also automatically re-balancing.

## ROFL intergrated

Coming soon

## Strategies intergrated

### AAVE V3 Finance Strategy

- SrcChain: Base
- DestCchain: Base
- Protocol: AAVE V3

USDC is deposited into AAVE V3, providing lending liquidity from which yield is generated.

### msUSD - USDC liquidity Strategy on Aerodrome Financce

- SrcChain: Base
- DestCchain: Base
- Protocol: Aerodrome Finance

Assets are split into 2 tokens msUSD and USDC to add liquidity to the [msUSD/USDC Pool Concentrated Stable 50](https://aerodrome.finance/deposit?token0=0x526728dbc96689597f85ae4cd716d4f7fccbae9d&token1=0x833589fcd6edb6e08f4c7c32d4f71b54bda02913&type=50&chain0=8453&chain1=8453&factory=0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A) with a safe tick range. Thereby generating profit through adding liquidity.

### USDC Lending Strategy on Jupiter Lend

- SrcChain: Base
- DestCchain: Solana
- Protocol: Jupiter Lend

Use the Across bridge via API to transfer funds between the Base and Solana networks. USDC is transferred to Solana and then deposited into Jupiter Lend to generate yield.

# Deployment

| Protocol                                        | Type                           | Test Vault | USDC V2 on Base |
| ----------------------------------------------- | ------------------------------ | ---------- | --------------- |
| [Wasabi Finance](https://wasabi.xyz/)           | Yield preps                    | ❌         | ❌              |
| [AAVE V3 Finance](https://aave.com/)            | Yield lending                  | ✅         | ✅              |
| [Aerodrome Finance](https://aerodrome.finance/) | msUSD - USDC liquidiy Strategy | ✅         | ✅              |
| [Jupiter Lending](https://jup.ag/lend/earn)     | USDC Vault                     | ✅         | ❌              |
