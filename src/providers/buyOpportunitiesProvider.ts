import * as vscode from 'vscode';
import { LunoAPI } from '../lunoApi';

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

export class BuyOpportunitiesProvider
  implements vscode.TreeDataProvider<BuyOpportunityItem>
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    BuyOpportunityItem | undefined | null | void
  > = new vscode.EventEmitter<BuyOpportunityItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    BuyOpportunityItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  private opportunities: CoinData[] = [];
  private loading = false;

  constructor(private lunoApi: LunoAPI) {}

  async refresh() {
    this.loading = true;
    this._onDidChangeTreeData.fire(null);

    try {
      this.opportunities = await this.lunoApi.getTopBuyOpportunities(10);
      this._onDidChangeTreeData.fire(null);
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to fetch buy opportunities: ${error}`
      );
    } finally {
      this.loading = false;
    }
  }

  getTreeItem(element: BuyOpportunityItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: BuyOpportunityItem): Thenable<BuyOpportunityItem[]> {
    if (this.loading) {
      return Promise.resolve([
        new BuyOpportunityItem(
          'Loading...',
          vscode.TreeItemCollapsibleState.None
        ),
      ]);
    }

    if (element) {
      return Promise.resolve(element.coinData ? this.getDetails(element.coinData) : []);
    }

    return Promise.resolve(
      this.opportunities.map(
        (coin, index) =>
          new BuyOpportunityItem(
            `#${index + 1}  ${coin.pair}  ${coin.buyScore.toFixed(0)}/100`,
            vscode.TreeItemCollapsibleState.Collapsed,
            coin
          )
      )
    );
  }

  private getDetails(coin: CoinData): BuyOpportunityItem[] {
    const recommendation = coin.buyScore >= 70 ? 'Watch for entry' : 'Wait for better setup';
    return [
      new BuyOpportunityItem(`Signal: ${recommendation}`, vscode.TreeItemCollapsibleState.None, undefined, 'lightbulb'),
      new BuyOpportunityItem(`Price: ${formatPrice(coin.currentPrice)}`, vscode.TreeItemCollapsibleState.None, undefined, 'tag'),
      new BuyOpportunityItem(`24h change: ${formatPercent(coin.changePercent24h)}`, vscode.TreeItemCollapsibleState.None, undefined, 'pulse'),
      new BuyOpportunityItem(`Volume: ${formatCompactNumber(coin.volume24h)}`, vscode.TreeItemCollapsibleState.None, undefined, 'bar-chart'),
    ];
  }
}

class BuyOpportunityItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly coinData?: CoinData,
    iconName = 'trending-down'
  ) {
    super(label, collapsibleState);

    if (coinData) {
      const scoreLabel = coinData.buyScore >= 70 ? 'Strong setup' : coinData.buyScore >= 50 ? 'Mixed setup' : 'Weak setup';
      this.description = `${scoreLabel}  |  ${formatPrice(coinData.currentPrice)}`;
      this.tooltip = this.generateTooltip(coinData);
    }

    this.iconPath = new vscode.ThemeIcon(iconName);
  }

  private generateTooltip(coin: CoinData): string {
    const priceFromLow = (
      ((coin.currentPrice - coin.low24h) / coin.low24h) *
      100
    ).toFixed(2);
    const priceFromHigh = (
      ((coin.currentPrice - coin.high24h) / coin.high24h) *
      100
    ).toFixed(2);

    return `
PAIR: ${coin.pair}
━━━━━━━━━━━━━━━━━━━━━━━━━━━
BUY SCORE: ${coin.buyScore.toFixed(0)}/100

CURRENT PRICE:
  RM${coin.currentPrice.toFixed(2)}

24-HOUR RANGE:
  Low:  RM${coin.low24h.toFixed(2)} (${priceFromLow}% below current)
  High: RM${coin.high24h.toFixed(2)} (${priceFromHigh}% above current)

PRICE MOVEMENT:
  24h Change: RM${coin.change24h.toFixed(2)}
  24h Change %: ${coin.changePercent24h.toFixed(2)}%

MARKET DATA:
  Bid: RM${coin.bid.toFixed(2)}
  Ask: RM${coin.ask.toFixed(2)}
  Spread: RM${(coin.ask - coin.bid).toFixed(2)}
  Volume (24h): RM${coin.volume24h.toLocaleString()}

💡 TIP: Higher score = better opportunity to buy!
    `;
  }
}

function formatPrice(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return 'N/A';
  if (value < 0.0001) return `RM${value.toFixed(8)}`;
  if (value < 1) return `RM${value.toFixed(4)}`;
  return `RM${value.toFixed(2)}`;
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return 'N/A';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return 'N/A';
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 }).format(value);
}
