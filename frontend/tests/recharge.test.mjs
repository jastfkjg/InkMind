import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const result = await build({ entryPoints: ['src/utils/recharge.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const { rechargeCents } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);

test('CNY amounts preserve cents without floating point rounding', () => {
  for (const [input, cents] of [['1', 100], ['1.01', 101], ['10.29', 1029], [' 50.5 ', 5050], ['0001.00', 100], ['1000000', 100000000]]) {
    assert.equal(rechargeCents(input, 100, 100000000), cents);
  }
});

test('invalid or out of range inputs are rejected instead of rounded', () => {
  for (const input of ['', '0', '0.99', '-1', '1.001', '1e2', 'Infinity', 'NaN', '1,000', '1.', '1000000.01', '9007199254740991']) {
    assert.equal(rechargeCents(input, 100, 100000000), null, input);
  }
});
