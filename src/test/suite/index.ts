import * as path from 'path';
import * as fs from 'fs';
import Mocha = require('mocha');

export function run(): Promise<void> {
  const mocha = new Mocha({
    ui: 'tdd',
    color: true,
  });

  const testsRoot = path.resolve(__dirname);
  return new Promise((resolve, reject) => {
    fs.readdirSync(testsRoot)
      .filter((file) => file.endsWith('.js'))
      .forEach((file) => mocha.addFile(path.join(testsRoot, file)));

    try {
      mocha.run((failures: number) => {
        if (failures > 0) {
          reject(new Error(`${failures} tests failed.`));
          return;
        }
        resolve();
      });
    } catch (err) {
      reject(err);
    }
  });
}
