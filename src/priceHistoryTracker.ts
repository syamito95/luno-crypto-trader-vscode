import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { LunoAPI } from './lunoApi';

interface PricePoint {
  timestamp: number;
  price: number;
  volume24h: number;
}

type HistoryStore = Record<string, PricePoint[]>;

const RETENTION_MS = 48 * 60 * 60 * 1000; // 48 hours
const SNAPSHOT_INTERVAL_MS = 60 * 1000; // 1 minute

export interface MomentumSignal {
  pair: string;
  currentPrice: number;
  changeLastHourPercent: number | null;
  changeLast15MinPercent: number | null;
  volume24h: number;
  dataPoints: number;
  warmupComplete: boolean;
  recommendation: 'BUY_CANDIDATE' | 'SELL_CANDIDATE' | 'HOLD' | 'INSUFFICIENT_DATA';
  reason: string;
}

export class PriceHistoryTracker {
  private history: HistoryStore = {};
  private filePath: string;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private context: vscode.ExtensionContext,
    private lunoApi: LunoAPI,
    private pairs: string[]
  ) {
    fs.mkdirSync(context.globalStorageUri.fsPath, { recursive: true });
    this.filePath = path.join(context.globalStorageUri.fsPath, 'price-history.json');
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(this.filePath)) {
        this.history = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      }
    } catch (error) {
      console.error('Failed to load price history:', error);
      this.history = {};
    }
  }

  private save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.history));
    } catch (error) {
      console.error('Failed to save price history:', error);
    }
  }

  start() {
    this.snapshot();
    this.timer = setInterval(() => this.snapshot(), SNAPSHOT_INTERVAL_MS);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async snapshot() {
    try {
      const tickers = await this.lunoApi.getTickers();
      const now = Date.now();

      for (const pair of this.pairs) {
        const ticker = tickers.find((t) => t.pair === pair);
        if (!ticker) {
          continue;
        }

        if (!this.history[pair]) {
          this.history[pair] = [];
        }

        this.history[pair].push({
          timestamp: now,
          price: ticker.currentPrice,
          volume24h: ticker.volume24h,
        });

        const cutoff = now - RETENTION_MS;
        this.history[pair] = this.history[pair].filter((p) => p.timestamp >= cutoff);
      }

      this.save();
    } catch (error) {
      console.error('Price snapshot failed:', error);
    }
  }

  private changeOverWindow(pair: string, windowMs: number): number | null {
    const points = this.history[pair];
    if (!points || points.length < 2) {
      return null;
    }

    const now = points[points.length - 1].timestamp;
    const target = now - windowMs;

    const reference = points.find((p) => p.timestamp >= target);
    if (!reference || reference.price <= 0) {
      return null;
    }

    const latest = points[points.length - 1];
    return ((latest.price - reference.price) / reference.price) * 100;
  }

  getMomentumSignal(pair: string): MomentumSignal {
    const points = this.history[pair] || [];
    const latest = points[points.length - 1];
    const currentPrice = latest?.price ?? 0;
    const volume24h = latest?.volume24h ?? 0;

    const changeLastHourPercent = this.changeOverWindow(pair, 60 * 60 * 1000);
    const changeLast15MinPercent = this.changeOverWindow(pair, 15 * 60 * 1000);

    const oldestTimestamp = points[0]?.timestamp ?? Date.now();
    const warmupComplete = Date.now() - oldestTimestamp >= 60 * 60 * 1000;

    if (!warmupComplete || changeLastHourPercent === null) {
      return {
        pair,
        currentPrice,
        changeLastHourPercent,
        changeLast15MinPercent,
        volume24h,
        dataPoints: points.length,
        warmupComplete,
        recommendation: 'INSUFFICIENT_DATA',
        reason: 'Still collecting price history. Needs at least 1 hour of data for a reliable signal.',
      };
    }

    let recommendation: MomentumSignal['recommendation'] = 'HOLD';
    let reason = 'No strong short-term signal.';

    if (changeLastHourPercent <= -3) {
      recommendation = 'BUY_CANDIDATE';
      reason = `Price dropped ${changeLastHourPercent.toFixed(2)}% in the last hour with active volume.`;
    } else if (changeLastHourPercent >= 5) {
      recommendation = 'SELL_CANDIDATE';
      reason = `Price rose ${changeLastHourPercent.toFixed(2)}% in the last hour, consider taking profit.`;
    }

    return {
      pair,
      currentPrice,
      changeLastHourPercent,
      changeLast15MinPercent,
      volume24h,
      dataPoints: points.length,
      warmupComplete,
      recommendation,
      reason,
    };
  }
}
