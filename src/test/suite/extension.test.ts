import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Luno extension', () => {
  test('should activate the extension', async () => {
    const ext = vscode.extensions.getExtension('luno-crypto-trader.luno-crypto-trader');
    assert.ok(ext, 'Extension should be installed and available');

    await ext?.activate();
    assert.ok(ext?.isActive, 'Extension should activate successfully');
  });
});
