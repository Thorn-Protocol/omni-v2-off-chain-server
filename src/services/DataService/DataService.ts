import axios from "axios";
import logger from "../../lib/winston";

export async function getAPYFromDefillama(code: string) {
  let dataDefillama = await getYieldPoolDefillama(code);
  return dataDefillama.apy;
}

export async function getTVLFromDefillama(code: string) {
  let dataDefillama = await getYieldPoolDefillama(code);
  return dataDefillama.tvl;
}

async function getYieldPoolDefillama(code: string) {
  const pool = code;
  const url = `https://yields.llama.fi/chart/${pool}`;
  try {
    const response = await axios.get(url);
    let result = response.data.data[response.data.data.length - 10];
    return {
      apy: result.apy,
      tvl: result.tvlUsd,
    };
  } catch (error) {
    throw Error(`Error fetching yield data for ${code}: ${error}`);
  }
}
