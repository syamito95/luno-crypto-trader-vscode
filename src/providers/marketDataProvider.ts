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

export class MarketDataProvider
  implements vscode.TreeDataProvider<CoinTreeItem>
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    CoinTreeItem | undefined | null | void
  > = new vscode.EventEmitter<CoinTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    CoinTreeItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  private coins: CoinData[] = [];
  private loading = false;

  constructor(private lunoApi: LunoAPI) {}

  async refresh() {
    this.loading = true;
    this._onDidChangeTreeData.fire(null);

    try {
      this.coins = await this.lunoApi.getTickers();
      this._onDidChangeTreeData.fire(null);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to fetch prices: ${error}`);
    } finally {
      this.loading = false;
    }
  }

  getTreeItem(element: CoinTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: CoinTreeItem): Thenable<CoinTreeItem[]> {
    if (this.loading) {
      return Promise.resolve([
        new CoinTreeItem('Loading...', vscode.TreeItemCollapsibleState.None),
      ]);
    }

    if (element) {
      return Promise.resolve(element.coinData ? this.getDetails(element.coinData) : []);
    }

    return Promise.resolve(
      this.coins.map(
        (coin) =>
          new CoinTreeItem(
            `${coin.pair}  ${formatPrice(coin.currentPrice)}`,
            vscode.TreeItemCollapsibleState.Collapsed,
            {
              title: 'View Details',
              command: 'vscode.open',
              arguments: [
                vscode.Uri.parse(
                  `https://www.luno.com/en/exchange/${coin.pair.toLowerCase()}`
                ),
              ],
            },
            coin
          )
      )
    );
  }

  private getDetails(coin: CoinData): CoinTreeItem[] {
    return [
      new CoinTreeItem(`24h: ${formatPercent(coin.changePercent24h)}`, vscode.TreeItemCollapsibleState.None, undefined, undefined, 'pulse'),
      new CoinTreeItem(`Range: ${formatPrice(coin.low24h)} - ${formatPrice(coin.high24h)}`, vscode.TreeItemCollapsibleState.None, undefined, undefined, 'graph-line'),
      new CoinTreeItem(`Volume: ${formatCompactNumber(coin.volume24h)}`, vscode.TreeItemCollapsibleState.None, undefined, undefined, 'bar-chart'),
      new CoinTreeItem(`Buy score: ${coin.buyScore.toFixed(0)}/100`, vscode.TreeItemCollapsibleState.None, undefined, undefined, 'star-full'),
    ];
  }
}

class CoinTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly command?: vscode.Command,
    public readonly coinData?: CoinData,
    iconName = 'symbol-variable'
  ) {
    super(label, collapsibleState);

    if (coinData) {
      this.description = `${formatPercent(coinData.changePercent24h)}  |  score ${coinData.buyScore.toFixed(0)}`;
      this.tooltip = this.generateTooltip(coinData);
    }

    this.iconPath = new vscode.ThemeIcon(iconName);
  }

  private generateTooltip(coin: CoinData): string {
    return `
Pair: ${coin.pair}
Current Price: RM${coin.currentPrice.toFixed(2)}
Bid: RM${coin.bid.toFixed(2)} | Ask: RM${coin.ask.toFixed(2)}
24h High: RM${coin.high24h.toFixed(2)}
24h Low: RM${coin.low24h.toFixed(2)}
24h Change: RM${coin.change24h.toFixed(2)} (${coin.changePercent24h.toFixed(2)}%)
24h Volume: RM${coin.volume24h.toLocaleString()}
Buy Score: ${coin.buyScore.toFixed(0)}/100
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
