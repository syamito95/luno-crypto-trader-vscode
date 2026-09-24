import * as vscode from 'vscode';
import { LunoAPI } from './lunoApi';
import { MarketDataProvider } from './providers/marketDataProvider';
import { BuyOpportunitiesProvider } from './providers/buyOpportunitiesProvider';
import { PriceHistoryTracker } from './priceHistoryTracker';

let lunoApi: LunoAPI | null = null;
let marketDataProvider: MarketDataProvider | null = null;
let buyOpportunitiesProvider: BuyOpportunitiesProvider | null = null;
let priceHistoryTracker: PriceHistoryTracker | null = null;

const TRACKED_PAIRS = ['XRPMYR', 'XRPXBT', 'ANKRMYR', 'LRCMYR', 'GRTMYR', 'SANDMYR', 'SEIMYR'];
const TEST_CAPITAL_MYR = 219;
const STOP_LOSS_PERCENT = -15;
const TAKE_PROFIT_PERCENT = 25;

export async function activate(context: vscode.ExtensionContext) {
  console.log('Luno Crypto Trader extension activated!');

  const storedKeyId = context.globalState.get<string>('lunoApiKeyId') || '';
  const storedKeySecret = context.globalState.get<string>('lunoApiKeySecret') || '';

  initializeLunoAPI(storedKeyId, storedKeySecret, context);

  if (!storedKeyId || !storedKeySecret) {
    vscode.window.showInformationMessage(
      'Showing public Luno market data. Configure API credentials later for account data.'
    );
  }

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('luno.refreshPrices', async () => {
      if (marketDataProvider) {
        await marketDataProvider.refresh();
      }
      if (buyOpportunitiesProvider) {
        await buyOpportunitiesProvider.refresh();
      }
      vscode.window.showInformationMessage('Prices refreshed!');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('luno.configurateCredentials', async () => {
      await configureCredentials(context);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('luno.showBalance', async () => {
      if (!lunoApi) {
        vscode.window.showErrorMessage('Configure Luno API credentials first.');
        return;
      }
      try {
        const accountInfo = await lunoApi.getAccountInfo();
        const balances = (accountInfo.balance || [])
          .filter((b: { balance: string }) => parseFloat(b.balance) > 0)
          .map((b: { asset: string; balance: string }) => `${b.asset}: ${b.balance}`)
          .join('\n');
        vscode.window.showInformationMessage(
          balances || 'No non-zero balances found.',
          { modal: true }
        );
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to fetch balance: ${error}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('luno.showXrpPosition', async () => {
      if (!lunoApi) {
        vscode.window.showErrorMessage('Configure Luno API credentials first.');
        return;
      }
      try {
        const trades = await lunoApi.getMyTrades('XRPMYR');
        if (trades.length === 0) {
          vscode.window.showInformationMessage('No XRPMYR trade history found on this account.');
          return;
        }

        const costBasis = lunoApi.computeCostBasis(trades);
        const tickers = await lunoApi.getTickers();
        const xrpTicker = tickers.find((t) => t.pair === 'XRPMYR');
        const currentPrice = xrpTicker?.currentPrice ?? 0;

        // Real wallet balance is the source of truth; trade history can miss
        // sends/withdrawals that never appear in /listtrades.
        const accountInfo = await lunoApi.getAccountInfo();
        const xrpBalance = (accountInfo.balance || []).find(
          (b: { asset: string }) => b.asset === 'XRP'
        );
        const actualHolding = xrpBalance ? parseFloat(xrpBalance.balance) : 0;

        const currentValue = actualHolding * currentPrice;
        const unrealizedCost = actualHolding * costBasis.averageBuyPrice;
        const unrealizedPnl = currentValue - unrealizedCost;
        const unrealizedPnlPercent =
          unrealizedCost > 0 ? (unrealizedPnl / unrealizedCost) * 100 : 0;

        const reconciliationNote =
          Math.abs(actualHolding - costBasis.remainingVolume) > 0.01
            ? `\nNote: trade history implies ${costBasis.remainingVolume.toFixed(4)} XRP remaining, but actual wallet balance is different. The gap is likely from past sends/withdrawals not recorded as trades. Wallet balance below is the trusted figure.\n`
            : '';

        const summary = `
XRP POSITION SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━
ACTUAL WALLET BALANCE: ${actualHolding.toFixed(4)} XRP
${reconciliationNote}
Historical average buy price: RM${costBasis.averageBuyPrice.toFixed(4)}
Current price:                RM${currentPrice.toFixed(4)}

Current value of your XRP: RM${currentValue.toFixed(2)}
Estimated unrealized P/L:  RM${unrealizedPnl.toFixed(2)} (${unrealizedPnlPercent >= 0 ? '+' : ''}${unrealizedPnlPercent.toFixed(2)}%)
        `;

        vscode.window.showInformationMessage(summary, { modal: true });
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to fetch XRP position: ${error}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('luno.showXrpSignal', async () => {
      if (!priceHistoryTracker) {
        vscode.window.showErrorMessage('Configure Luno API credentials first.');
        return;
      }

      const myr = priceHistoryTracker.getMomentumSignal('XRPMYR');
      const xbt = priceHistoryTracker.getMomentumSignal('XRPXBT');

      const format = (v: number | null) => (v === null ? 'N/A' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`);

      let sellSuggestion = '';
      if (myr.recommendation === 'SELL_CANDIDATE' && lunoApi) {
        try {
          const accountInfo = await lunoApi.getAccountInfo();
          const xrpBalance = (accountInfo.balance || []).find(
            (b: { asset: string }) => b.asset === 'XRP'
          );
          const holding = xrpBalance ? parseFloat(xrpBalance.balance) : 0;
          const suggestedSellAmount = holding * 0.5;
          sellSuggestion = `\nSUGGESTED ACTION: Consider selling ${suggestedSellAmount.toFixed(4)} XRP (50% of your ${holding.toFixed(4)} XRP holding). You must confirm and place this manually.\n`;
        } catch {
          // Balance lookup failing shouldn't block showing the signal itself.
        }
      }

      const summary = `
XRP MOMENTUM SIGNAL (suggestion only, not auto-executed)
━━━━━━━━━━━━━━━━━━━━━━━━━━━
XRPMYR
  Price: RM${myr.currentPrice.toFixed(4)}
  Last hour: ${format(myr.changeLastHourPercent)}
  Last 15 min: ${format(myr.changeLast15MinPercent)}
  Data points collected: ${myr.dataPoints}
  Signal: ${myr.recommendation}
  Reason: ${myr.reason}
${sellSuggestion}
XRPXBT (XRP priced in Bitcoin, market-relative strength)
  Price: ${xbt.currentPrice.toFixed(8)}
  Last hour: ${format(xbt.changeLastHourPercent)}
  Signal: ${xbt.recommendation}

This is analysis only. Review before placing any real order.
      `;

      vscode.window.showInformationMessage(summary, { modal: true });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('luno.suggestTestTrade', async () => {
      if (!priceHistoryTracker) {
        vscode.window.showErrorMessage('Configure Luno API credentials first.');
        return;
      }

      const myrPairs = TRACKED_PAIRS.filter((p) => p.endsWith('MYR'));
      const candidates = myrPairs
        .map((pair) => priceHistoryTracker!.getMomentumSignal(pair))
        .filter((s) => s.recommendation === 'BUY_CANDIDATE')
        .sort((a, b) => (a.changeLastHourPercent ?? 0) - (b.changeLastHourPercent ?? 0));

      if (candidates.length === 0) {
        vscode.window.showInformationMessage(
          'No BUY_CANDIDATE found among tracked coins right now. No trade suggested. Try again later.'
        );
        return;
      }

      const best = candidates[0];
      const volumeQty = TEST_CAPITAL_MYR / best.currentPrice;
      const stopLossPrice = best.currentPrice * (1 + STOP_LOSS_PERCENT / 100);
      const takeProfitPrice = best.currentPrice * (1 + TAKE_PROFIT_PERCENT / 100);

      const summary = `
TEST TRADE SUGGESTION (RM${TEST_CAPITAL_MYR} capital)
━━━━━━━━━━━━━━━━━━━━━━━━━━━
Best candidate: ${best.pair}
Reason: ${best.reason}

Suggested buy: RM${TEST_CAPITAL_MYR} (~${volumeQty.toFixed(4)} ${best.pair.replace('MYR', '')})
Entry price: RM${best.currentPrice.toFixed(4)}

Mandatory risk rules:
  Stop-loss:   RM${stopLossPrice.toFixed(4)} (${STOP_LOSS_PERCENT}%)
  Take-profit: RM${takeProfitPrice.toFixed(4)} (+${TAKE_PROFIT_PERCENT}%)

Nothing has been executed. This is a suggestion only.
      `;

      vscode.window.showInformationMessage(summary, { modal: true });
    })
  );
}

async function configureCredentials(context: vscode.ExtensionContext) {
  const keyId = await vscode.window.showInputBox({
    prompt: 'Enter your Luno API Key ID',
    password: false,
    placeHolder: 'Your API Key ID',
  });

  if (!keyId) {
    return;
  }

  const keySecret = await vscode.window.showInputBox({
    prompt: 'Enter your Luno API Key Secret',
    password: true,
    placeHolder: 'Your API Key Secret',
  });

  if (!keySecret) {
    return;
  }

  // Store credentials securely
  await context.globalState.update('lunoApiKeyId', keyId);
  await context.globalState.update('lunoApiKeySecret', keySecret);

  // Initialize API
  initializeLunoAPI(keyId, keySecret, context);

  vscode.window.showInformationMessage(
    'Luno credentials configured successfully!'
  );
}

function initializeLunoAPI(
  keyId: string,
  keySecret: string,
  context: vscode.ExtensionContext
) {
  lunoApi = new LunoAPI(keyId, keySecret);

  // Initialize providers
  marketDataProvider = new MarketDataProvider(lunoApi);
  buyOpportunitiesProvider = new BuyOpportunitiesProvider(lunoApi);

  priceHistoryTracker?.stop();
  priceHistoryTracker = new PriceHistoryTracker(context, lunoApi, TRACKED_PAIRS);
  priceHistoryTracker.start();

  // Register tree views so the custom side panels are mounted in the activity bar
  const marketTreeView = vscode.window.createTreeView('lunoMarkets', {
    treeDataProvider: marketDataProvider,
    showCollapseAll: true,
  });
  const buyOpportunitiesTreeView = vscode.window.createTreeView(
    'lunoBuyOpportunities',
    {
      treeDataProvider: buyOpportunitiesProvider,
      showCollapseAll: true,
    }
  );

  context.subscriptions.push(marketTreeView, buyOpportunitiesTreeView);

  // Auto-refresh every 5 minutes
  setInterval(async () => {
    try {
      await marketDataProvider?.refresh();
      await buyOpportunitiesProvider?.refresh();
    } catch (error) {
      console.error('Auto-refresh failed:', error);
    }
  }, 5 * 60 * 1000);

  // Initial load
  marketDataProvider.refresh();
  buyOpportunitiesProvider.refresh();
}

export function deactivate() {
  console.log('Luno Crypto Trader extension deactivated!');
}
