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
      return Promise.resolve([]);
    }

    return Promise.resolve(
      this.coins.map(
        (coin) =>
          new CoinTreeItem(
            `${coin.pair}: R${coin.currentPrice.toFixed(2)}`,
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
}

class CoinTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly command?: vscode.Command,
    public readonly coinData?: CoinData
  ) {
    super(label, collapsibleState);

    if (coinData) {
      const changeEmoji = coinData.changePercent24h >= 0 ? '📈' : '📉';
      this.description = `${changeEmoji} ${coinData.changePercent24h.toFixed(2)}%`;
      this.tooltip = this.generateTooltip(coinData);
    }

    this.iconPath = new vscode.ThemeIcon('symbol-variable');
  }

  private generateTooltip(coin: CoinData): string {
    return `
Pair: ${coin.pair}
Current Price: R${coin.currentPrice.toFixed(2)}
Bid: R${coin.bid.toFixed(2)} | Ask: R${coin.ask.toFixed(2)}
24h High: R${coin.high24h.toFixed(2)}
24h Low: R${coin.low24h.toFixed(2)}
24h Change: R${coin.change24h.toFixed(2)} (${coin.changePercent24h.toFixed(2)}%)
24h Volume: R${coin.volume24h.toLocaleString()}
Buy Score: ${coin.buyScore.toFixed(0)}/100
    `;
  }
}
