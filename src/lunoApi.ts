import axios, { AxiosInstance } from 'axios';

interface Ticker {
  pair: string;
  bid: string;
  ask: string;
  last_trade: string;
  rolling_24_hour_high: string;
  rolling_24_hour_low: string;
  rolling_24_hour_volume: string;
  status: string;
  timestamp: number;
}

interface CoinData {
  pair: string;
  currentPrice: number;
  bid: number;
  ask: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  change24h: number;
  changePercent24h: number;
  buyScore: number;
}

interface UserTrade {
  base: string;
  counter: string;
  fee_base: string;
  fee_counter: string;
  is_buy: boolean;
  order_id: string;
  pair: string;
  price: string;
  timestamp: number;
  type: string;
  volume: string;
}

interface CostBasis {
  totalBought: number;
  totalSold: number;
  remainingVolume: number;
  averageBuyPrice: number;
  totalCost: number;
  totalProceeds: number;
}

export class LunoAPI {
  private apiClient: AxiosInstance;
  private apiKeyId: string;
  private apiKeySecret: string;
  private baseUrl = 'https://api.luno.com/api';

  constructor(apiKeyId: string, apiKeySecret: string) {
    this.apiKeyId = apiKeyId;
    this.apiKeySecret = apiKeySecret;

    const authConfig =
      apiKeyId && apiKeySecret
        ? {
            auth: {
              username: apiKeyId,
              password: apiKeySecret,
            },
          }
        : {};

    this.apiClient = axios.create({
      baseURL: this.baseUrl,
      ...authConfig,
    });
  }

  /**
   * Fetch all available trading pairs and their current prices
   */
  async getTickers(): Promise<CoinData[]> {
    try {
      const response = await this.apiClient.get<{ tickers: Ticker[] }>(
        '/1/tickers'
      );
      
      const coinDataList: CoinData[] = response.data.tickers
        .filter((ticker) => ticker.status === 'ACTIVE')
        .map((ticker) => this.parseTicker(ticker));

      return coinDataList;
    } catch (error) {
      console.error('API Error:', error);
      throw new Error(`Failed to fetch tickers: ${error}`);
    }
  }

  /**
   * Parse ticker data and calculate metrics
   */
  private parseTicker(ticker: Ticker): CoinData {
    const currentPrice = parseFloat(ticker.last_trade || ticker.ask) || 0;
    const bid = parseFloat(ticker.bid) || 0;
    const ask = parseFloat(ticker.ask) || 0;
    const high24h = parseFloat(ticker.rolling_24_hour_high) || 0;
    const low24h = parseFloat(ticker.rolling_24_hour_low) || 0;
    const volume24h = parseFloat(ticker.rolling_24_hour_volume) || 0;

    const hasValidLow = low24h > 0;
    const hasValidRange = high24h > 0 && low24h > 0 && high24h >= low24h;

    const change24h = hasValidLow ? currentPrice - low24h : 0;
    const changePercent24h = hasValidLow ? (change24h / low24h) * 100 : 0;

    // Buy Score: 0-100
    // Higher score = better to buy (price closer to 24h low)
    const priceRange = hasValidRange ? high24h - low24h : 0;
    const priceFromLow = hasValidLow ? currentPrice - low24h : 0;
    const priceRangePercent = priceRange > 0 ? (priceFromLow / priceRange) * 100 : 0;
    const buyScore = hasValidRange
      ? Math.max(0, Math.min(100, 100 - priceRangePercent))
      : 0;

    return {
      pair: ticker.pair,
      currentPrice,
      bid,
      ask,
      high24h,
      low24h,
      volume24h,
      change24h,
      changePercent24h,
      buyScore,
    };
  }

  /**
   * Get wallet balances (requires Perm_R_Balance)
   */
  async getAccountInfo() {
    try {
      const response = await this.apiClient.get('/1/balance');
      return response.data;
    } catch (error) {
      throw new Error(`Failed to fetch account info: ${error}`);
    }
  }

  /**
   * Get this account's own executed trades for a pair (requires Perm_R_Orders)
   */
  async getMyTrades(pair: string): Promise<UserTrade[]> {
    try {
      const response = await this.apiClient.get<{ trades: UserTrade[] }>(
        '/1/listtrades',
        { params: { pair, sort_desc: false, limit: 1000 } }
      );
      return response.data.trades || [];
    } catch (error) {
      throw new Error(`Failed to fetch trade history: ${error}`);
    }
  }

  /**
   * Compute weighted average buy price and remaining position from trade history
   */
  computeCostBasis(trades: UserTrade[]): CostBasis {
    let boughtVolume = 0;
    let boughtCost = 0;
    let soldVolume = 0;
    let soldProceeds = 0;

    for (const trade of trades) {
      const volume = parseFloat(trade.base);
      const cost = parseFloat(trade.counter);
      const isBuy = trade.is_buy;

      if (isBuy) {
        boughtVolume += volume;
        boughtCost += cost;
      } else {
        soldVolume += volume;
        soldProceeds += cost;
      }
    }

    const remainingVolume = boughtVolume - soldVolume;
    const averageBuyPrice = boughtVolume > 0 ? boughtCost / boughtVolume : 0;

    return {
      totalBought: boughtVolume,
      totalSold: soldVolume,
      remainingVolume,
      averageBuyPrice,
      totalCost: boughtCost,
      totalProceeds: soldProceeds,
    };
  }

  /**
   * Get top coins to buy (sorted by buy score)
   */
  async getTopBuyOpportunities(limit: number = 5): Promise<CoinData[]> {
    const tickers = await this.getTickers();
    return tickers
      .sort((a, b) => b.buyScore - a.buyScore)
      .slice(0, limit);
  }

  /**
   * Filter coins by price range
   */
  async getCoinsByPriceRange(
    minPrice: number,
    maxPrice: number
  ): Promise<CoinData[]> {
    const tickers = await this.getTickers();
    return tickers.filter(
      (coin) =>
        coin.currentPrice >= minPrice && coin.currentPrice <= maxPrice
    );
  }
}
