import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import { LunoAPI } from './lunoApi';

const TRACKED_MYR_PAIRS = ['XRPMYR', 'ANKRMYR', 'LRCMYR', 'GRTMYR', 'SANDMYR', 'SEIMYR'];
const XRP_SELL_THRESHOLD_PERCENT = 5;
const BUY_DIP_THRESHOLD_PERCENT = -3;
const XRP_SELL_PORTION = 0.5;
const TEST_CAPITAL_MYR = 219;
const STOP_LOSS_PERCENT = -15;
const TAKE_PROFIT_PERCENT = 25;
const RETENTION_MS = 48 * 60 * 60 * 1000;

interface PricePoint {
  timestamp: number;
  price: number;
}

type HistoryStore = Record<string, PricePoint[]>;

const HISTORY_PATH = path.join(__dirname, '..', 'data', 'price-history.json');

function loadHistory(): HistoryStore {
  try {
    if (fs.existsSync(HISTORY_PATH)) {
      return JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
    }
  } catch (error) {
    console.error('Failed to load history:', error);
  }
  return {};
}

function saveHistory(history: HistoryStore) {
  fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history));
}

function changeOverWindow(points: PricePoint[], windowMs: number): number | null {
  if (points.length < 2) {
    return null;
  }
  const latest = points[points.length - 1];
  const target = latest.timestamp - windowMs;
  const reference = points.find((p) => p.timestamp >= target);
  if (!reference || reference.price <= 0) {
    return null;
  }
  return ((latest.price - reference.price) / reference.price) * 100;
}

function sendTelegramMessage(token: string, chatId: string, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' });
    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path: `/bot${token}/sendMessage`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve());
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function main() {
  const keyId = process.env.LUNO_API_KEY_ID || '';
  const keySecret = process.env.LUNO_API_KEY_SECRET || '';
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN || '';
  const telegramChatId = process.env.TELEGRAM_CHAT_ID || '';

  if (!keyId || !keySecret || !telegramToken || !telegramChatId) {
    console.error('Missing required environment variables. Aborting.');
    process.exit(1);
  }

  const lunoApi = new LunoAPI(keyId, keySecret);
  const history = loadHistory();
  const tickers = await lunoApi.getTickers();
  const now = Date.now();

  const allTrackedPairs = ['XRPMYR', 'XRPXBT', ...TRACKED_MYR_PAIRS.filter((p) => p !== 'XRPMYR')];

  for (const pair of allTrackedPairs) {
    const ticker = tickers.find((t) => t.pair === pair);
    if (!ticker) {
      continue;
    }
    if (!history[pair]) {
      history[pair] = [];
    }
    history[pair].push({ timestamp: now, price: ticker.currentPrice });
    history[pair] = history[pair].filter((p) => p.timestamp >= now - RETENTION_MS);
  }

  const messages: string[] = [];

  // --- XRP sell rule ---
  const xrpChange = changeOverWindow(history['XRPMYR'] || [], 60 * 60 * 1000);
  if (xrpChange !== null && xrpChange >= XRP_SELL_THRESHOLD_PERCENT) {
    try {
      const accountInfo = await lunoApi.getAccountInfo();
      const xrpBalance = (accountInfo.balance || []).find((b: { asset: string }) => b.asset === 'XRP');
      const holding = xrpBalance ? parseFloat(xrpBalance.balance) : 0;
      const suggestedSell = holding * XRP_SELL_PORTION;
      messages.push(
        `<b>XRP SELL SIGNAL</b>\nXRP is up ${xrpChange.toFixed(2)}% in the last hour.\nSuggested: sell ${suggestedSell.toFixed(4)} XRP (50% of your ${holding.toFixed(4)} XRP).\nConfirm manually in Luno before acting.`
      );
    } catch (error) {
      console.error('Failed to fetch balance for sell suggestion:', error);
    }
  }

  // --- RM219 test trade rule ---
  const buyCandidates = TRACKED_MYR_PAIRS
    .map((pair) => {
      const change = changeOverWindow(history[pair] || [], 60 * 60 * 1000);
      const ticker = tickers.find((t) => t.pair === pair);
      return { pair, change, price: ticker?.currentPrice ?? 0 };
    })
    .filter((c) => c.change !== null && c.change <= BUY_DIP_THRESHOLD_PERCENT && c.price > 0)
    .sort((a, b) => (a.change ?? 0) - (b.change ?? 0));

  if (buyCandidates.length > 0) {
    const best = buyCandidates[0];
    const qty = TEST_CAPITAL_MYR / best.price;
    const stopLossPrice = best.price * (1 + STOP_LOSS_PERCENT / 100);
    const takeProfitPrice = best.price * (1 + TAKE_PROFIT_PERCENT / 100);
    messages.push(
      `<b>RM${TEST_CAPITAL_MYR} TEST TRADE SUGGESTION</b>\nBest candidate: ${best.pair} (${(best.change ?? 0).toFixed(2)}% in last hour)\nBuy ~${qty.toFixed(4)} ${best.pair.replace('MYR', '')} at RM${best.price.toFixed(4)}\nStop-loss: RM${stopLossPrice.toFixed(4)} | Take-profit: RM${takeProfitPrice.toFixed(4)}\nConfirm manually in Luno before acting.`
    );
  }

  saveHistory(history);

  if (messages.length > 0) {
    await sendTelegramMessage(telegramToken, telegramChatId, messages.join('\n\n'));
    console.log('Sent Telegram notification.');
  } else {
    console.log('No signal this run. Nothing sent.');
  }
}

main().catch((error) => {
  console.error('Monitor run failed:', error);
  process.exit(1);
});
