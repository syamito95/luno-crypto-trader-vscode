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

export class LunoAPI {
  private apiClient: AxiosInstance;
  private apiKeyId: string;
  private apiKeySecret: string;
  private baseUrl = 'https://api.mybitx.com/api';

  constructor(apiKeyId: string, apiKeySecret: string) {
    this.apiKeyId = apiKeyId;
    this.apiKeySecret = apiKeySecret;

    this.apiClient = axios.create({
      baseURL: this.baseUrl,
      auth: {
        username: apiKeyId,
        password: apiKeySecret,
      },
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
    const currentPrice = parseFloat(ticker.last_trade || ticker.ask);
    const bid = parseFloat(ticker.bid);
    const ask = parseFloat(ticker.ask);
    const high24h = parseFloat(ticker.rolling_24_hour_high);
    const low24h = parseFloat(ticker.rolling_24_hour_low);
    const volume24h = parseFloat(ticker.rolling_24_hour_volume);

    const change24h = currentPrice - low24h;
    const changePercent24h = (change24h / low24h) * 100;

    // Buy Score: 0-100
    // Higher score = better to buy (price closer to 24h low)
    const priceRange = high24h - low24h;
    const priceFromLow = currentPrice - low24h;
    const priceRangePercent = priceRange > 0 ? (priceFromLow / priceRange) * 100 : 0;
    const buyScore = Math.max(0, Math.min(100, 100 - priceRangePercent));

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
   * Get account info (requires read access)
   */
  async getAccountInfo() {
    try {
      const response = await this.apiClient.get('/1/accounts');
      return response.data;
    } catch (error) {
      throw new Error(`Failed to fetch account info: ${error}`);
    }
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
