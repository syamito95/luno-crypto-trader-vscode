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

interface PaperPosition {
  id: string;
  pair: string;
  entryPrice: number;
  quantity: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  openedAt: number;
}

interface ClosedPaperPosition extends PaperPosition {
  closePrice: number;
  closedAt: number;
  closeReason: 'TAKE_PROFIT' | 'STOP_LOSS';
  pnlMyr: number;
  pnlPercent: number;
}

interface SellSignalEvent {
  timestamp: number;
  price: number;
  changeLastHourPercent: number;
}

interface PaperState {
  openPositions: PaperPosition[];
  closedPositions: ClosedPaperPosition[];
  sellSignalLog: SellSignalEvent[];
}

const HISTORY_PATH = path.join(__dirname, '..', 'data', 'price-history.json');
const PAPER_STATE_PATH = path.join(__dirname, '..', 'data', 'paper-trades.json');

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

function loadPaperState(): PaperState {
  try {
    if (fs.existsSync(PAPER_STATE_PATH)) {
      return JSON.parse(fs.readFileSync(PAPER_STATE_PATH, 'utf8'));
    }
  } catch (error) {
    console.error('Failed to load paper trade state:', error);
  }
  return { openPositions: [], closedPositions: [], sellSignalLog: [] };
}

function savePaperState(state: PaperState) {
  fs.mkdirSync(path.dirname(PAPER_STATE_PATH), { recursive: true });
  fs.writeFileSync(PAPER_STATE_PATH, JSON.stringify(state));
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
  const paperState = loadPaperState();
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

  // --- Manage open paper positions: close on stop-loss / take-profit ---
  const stillOpen: PaperPosition[] = [];
  for (const position of paperState.openPositions) {
    const ticker = tickers.find((t) => t.pair === position.pair);
    const currentPrice = ticker?.currentPrice ?? 0;

    if (currentPrice <= 0) {
      stillOpen.push(position);
      continue;
    }

    let closeReason: ClosedPaperPosition['closeReason'] | null = null;
    if (currentPrice >= position.takeProfitPrice) {
      closeReason = 'TAKE_PROFIT';
    } else if (currentPrice <= position.stopLossPrice) {
      closeReason = 'STOP_LOSS';
    }

    if (closeReason) {
      const pnlMyr = (currentPrice - position.entryPrice) * position.quantity;
      const pnlPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
      paperState.closedPositions.push({
        ...position,
        closePrice: currentPrice,
        closedAt: now,
        closeReason,
        pnlMyr,
        pnlPercent,
      });
      messages.push(
        `<b>PAPER TRADE CLOSED (${closeReason})</b>\n${position.pair}: entry RM${position.entryPrice.toFixed(4)} -> close RM${currentPrice.toFixed(4)}\nSimulated P/L: RM${pnlMyr.toFixed(2)} (${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%)\nThis was a simulation only, no real money involved.`
      );
    } else {
      stillOpen.push(position);
    }
  }
  paperState.openPositions = stillOpen;

  // --- XRP sell rule (real holding, suggestion only) ---
  const xrpChange = changeOverWindow(history['XRPMYR'] || [], 60 * 60 * 1000);
  if (xrpChange !== null && xrpChange >= XRP_SELL_THRESHOLD_PERCENT) {
    const xrpTicker = tickers.find((t) => t.pair === 'XRPMYR');
    paperState.sellSignalLog.push({
      timestamp: now,
      price: xrpTicker?.currentPrice ?? 0,
      changeLastHourPercent: xrpChange,
    });

    try {
      const accountInfo = await lunoApi.getAccountInfo();
      const xrpBalance = (accountInfo.balance || []).find((b: { asset: string }) => b.asset === 'XRP');
      const holding = xrpBalance ? parseFloat(xrpBalance.balance) : 0;
      const suggestedSell = holding * XRP_SELL_PORTION;
      messages.push(
        `<b>XRP SELL SIGNAL (logged, not executed)</b>\nXRP is up ${xrpChange.toFixed(2)}% in the last hour.\nSuggested: sell ${suggestedSell.toFixed(4)} XRP (50% of your ${holding.toFixed(4)} XRP).\nThis is a suggestion only; nothing was sold.`
      );
    } catch (error) {
      console.error('Failed to fetch balance for sell suggestion:', error);
    }
  }

  // --- RM219 test trade rule: open a paper position instead of real money ---
  const alreadyOpenPairs = new Set(paperState.openPositions.map((p) => p.pair));
  const buyCandidates = TRACKED_MYR_PAIRS
    .map((pair) => {
      const change = changeOverWindow(history[pair] || [], 60 * 60 * 1000);
      const ticker = tickers.find((t) => t.pair === pair);
      return { pair, change, price: ticker?.currentPrice ?? 0 };
    })
    .filter(
      (c) =>
        c.change !== null &&
        c.change <= BUY_DIP_THRESHOLD_PERCENT &&
        c.price > 0 &&
        !alreadyOpenPairs.has(c.pair)
    )
    .sort((a, b) => (a.change ?? 0) - (b.change ?? 0));

  if (buyCandidates.length > 0) {
    const best = buyCandidates[0];
    const qty = TEST_CAPITAL_MYR / best.price;
    const stopLossPrice = best.price * (1 + STOP_LOSS_PERCENT / 100);
    const takeProfitPrice = best.price * (1 + TAKE_PROFIT_PERCENT / 100);

    paperState.openPositions.push({
      id: `${best.pair}-${now}`,
      pair: best.pair,
      entryPrice: best.price,
      quantity: qty,
      stopLossPrice,
      takeProfitPrice,
      openedAt: now,
    });

    messages.push(
      `<b>PAPER TRADE OPENED (simulation, RM${TEST_CAPITAL_MYR})</b>\nBest candidate: ${best.pair} (${(best.change ?? 0).toFixed(2)}% in last hour)\nSimulated buy: ~${qty.toFixed(4)} ${best.pair.replace('MYR', '')} at RM${best.price.toFixed(4)}\nStop-loss: RM${stopLossPrice.toFixed(4)} | Take-profit: RM${takeProfitPrice.toFixed(4)}\nNo real money was spent.`
    );
  }

  saveHistory(history);
  savePaperState(paperState);

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
