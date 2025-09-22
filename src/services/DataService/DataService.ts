import axios, { AxiosResponse } from "axios";

// ==================== TYPES ====================
/** Defillama yield pool data structure */
interface DefillamaYieldData {
  apy: number;
  tvlUsd: number;
}

/** Defillama API response structure */
interface DefillamaResponse {
  data: DefillamaYieldData[];
}

// ==================== CONSTANTS ====================
/** Base URL for Defillama yields API */
const DEFILLAMA_YIELDS_BASE_URL = "https://yields.llama.fi/chart";

/** Number of data points to look back for average calculation */
const DATA_POINTS_LOOKBACK = 10;

// ==================== PUBLIC FUNCTIONS ====================

/**
 * Fetches APY (Annual Percentage Yield) from Defillama for a specific pool
 *
 * @param code - Defillama pool code/identifier
 * @returns Promise<number> - Current APY percentage
 * @throws Error if failed to fetch data or invalid response
 */
export async function getAPYFromDefillama(code: string): Promise<number> {
  if (!code || typeof code !== "string") {
    throw new Error("Pool code must be a non-empty string");
  }

  try {
    const yieldData = await getYieldPoolDefillama(code);
    return yieldData.apy;
  } catch (error) {
    throw new Error(`Failed to fetch APY for pool ${code}: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

/**
 * Fetches TVL (Total Value Locked) from Defillama for a specific pool
 *
 * @param code - Defillama pool code/identifier
 * @returns Promise<number> - Current TVL in USD
 * @throws Error if failed to fetch data or invalid response
 */
export async function getTVLFromDefillama(code: string): Promise<number> {
  if (!code || typeof code !== "string") {
    throw new Error("Pool code must be a non-empty string");
  }

  try {
    const yieldData = await getYieldPoolDefillama(code);
    return yieldData.tvlUsd;
  } catch (error) {
    throw new Error(`Failed to fetch TVL for pool ${code}: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

// ==================== PRIVATE FUNCTIONS ====================

/**
 * Fetches yield pool data from Defillama API
 *
 * This function retrieves historical yield data for a specific pool
 * and returns the average of the last 10 data points for stability.
 *
 * @param code - Defillama pool code/identifier
 * @returns Promise<DefillamaYieldData> - Pool yield data (APY and TVL)
 * @throws Error if API request fails or data is invalid
 */
async function getYieldPoolDefillama(code: string): Promise<DefillamaYieldData> {
  const url = `${DEFILLAMA_YIELDS_BASE_URL}/${code}`;

  try {
    const response: AxiosResponse<DefillamaResponse> = await axios.get(url);

    // Validate response structure
    if (!response.data || !Array.isArray(response.data.data) || response.data.data.length === 0) {
      throw new Error("Invalid response structure from Defillama API");
    }

    const dataPoints = response.data.data;

    // Ensure we have enough data points
    if (dataPoints.length < DATA_POINTS_LOOKBACK) {
      throw new Error(`Insufficient data points: expected at least ${DATA_POINTS_LOOKBACK}, got ${dataPoints.length}`);
    }

    // Get the most recent data point (last element in array)
    const latestData = dataPoints[dataPoints.length - 1];

    // Validate data structure
    if (typeof latestData.apy !== "number" || typeof latestData.tvlUsd !== "number") {
      throw new Error("Invalid data structure in Defillama response");
    }

    return {
      apy: latestData.apy,
      tvlUsd: latestData.tvlUsd,
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const statusText = error.response?.statusText;
      throw new Error(`Defillama API error (${status} ${statusText}): ${error.message}`);
    }

    throw new Error(`Failed to fetch yield data for pool ${code}: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}
