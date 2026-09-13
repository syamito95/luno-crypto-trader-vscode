import * as vscode from 'vscode';
import { LunoAPI } from './lunoApi';
import { MarketDataProvider } from './providers/marketDataProvider';
import { BuyOpportunitiesProvider } from './providers/buyOpportunitiesProvider';

let lunoApi: LunoAPI | null = null;
let marketDataProvider: MarketDataProvider | null = null;
let buyOpportunitiesProvider: BuyOpportunitiesProvider | null = null;

export async function activate(context: vscode.ExtensionContext) {
  console.log('Luno Crypto Trader extension activated!');

  // Load stored credentials
  const storedKeyId = context.globalState.get<string>('lunoApiKeyId');
  const storedKeySecret = context.globalState.get<string>('lunoApiKeySecret');

  if (storedKeyId && storedKeySecret) {
    initializeLunoAPI(storedKeyId, storedKeySecret, context);
  } else {
    // Ask user to configure credentials
    const result = await vscode.window.showInformationMessage(
      'Luno API credentials not configured. Would you like to set them up now?',
      'Yes',
      'Later'
    );
    if (result === 'Yes') {
      await configureCredentials(context);
    }
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

  // Register tree data providers
  vscode.window.registerTreeDataProvider('lunoMarkets', marketDataProvider);
  vscode.window.registerTreeDataProvider(
    'lunoBuyOpportunities',
    buyOpportunitiesProvider
  );

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
