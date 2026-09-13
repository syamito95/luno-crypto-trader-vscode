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
      return Promise.resolve([]);
    }

    return Promise.resolve(
      this.opportunities.map(
        (coin, index) =>
          new BuyOpportunityItem(
            `#${index + 1} ${coin.pair} - Score: ${coin.buyScore.toFixed(0)}/100`,
            vscode.TreeItemCollapsibleState.Collapsed,
            coin
          )
      )
    );
  }
}

class BuyOpportunityItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly coinData?: CoinData
  ) {
    super(label, collapsibleState);

    if (coinData) {
      const scoreColor =
        coinData.buyScore >= 70
          ? '🟢'
          : coinData.buyScore >= 50
            ? '🟡'
            : '🔴';
      this.description = `${scoreColor} Current: R${coinData.currentPrice.toFixed(2)}`;
      this.tooltip = this.generateTooltip(coinData);
    }

    this.iconPath = new vscode.ThemeIcon('trending-down');
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
  R${coin.currentPrice.toFixed(2)}

24-HOUR RANGE:
  Low:  R${coin.low24h.toFixed(2)} (${priceFromLow}% below current)
  High: R${coin.high24h.toFixed(2)} (${priceFromHigh}% above current)

PRICE MOVEMENT:
  24h Change: R${coin.change24h.toFixed(2)}
  24h Change %: ${coin.changePercent24h.toFixed(2)}%

MARKET DATA:
  Bid: R${coin.bid.toFixed(2)}
  Ask: R${coin.ask.toFixed(2)}
  Spread: R${(coin.ask - coin.bid).toFixed(2)}
  Volume (24h): R${coin.volume24h.toLocaleString()}

💡 TIP: Higher score = better opportunity to buy!
    `;
  }
}
