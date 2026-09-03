'use strict';
const assert = require('assert');
const lan = require('./lan');

assert.strictEqual(lan.isPrivateV4('192.168.1.5'), true);
assert.strictEqual(lan.isPrivateV4('10.0.0.2'), true);
assert.strictEqual(lan.isPrivateV4('172.16.0.1'), true);
assert.strictEqual(lan.isPrivateV4('172.31.255.1'), true);
assert.strictEqual(lan.isPrivateV4('172.15.0.1'), false);
assert.strictEqual(lan.isPrivateV4('127.0.0.1'), false);
assert.strictEqual(lan.isPrivateV4('169.254.1.1'), false);
assert.strictEqual(lan.isPrivateV4('8.8.8.8'), false);

assert.ok(
  lan.scoreAddress('Wi-Fi', '192.168.1.5') > lan.scoreAddress('vEthernet (WSL)', '172.24.80.1'),
  'Wi-Fi 192.168 should outrank Hyper-V/WSL'
);
assert.ok(
  lan.scoreAddress('wlan0', '192.168.0.10') > lan.scoreAddress('docker0', '172.17.0.1'),
  'wlan should outrank docker'
);
assert.ok(lan.scoreAddress('eth0', '10.0.0.5') > 0);
assert.strictEqual(lan.scoreAddress('lo', '127.0.0.1'), -1);

assert.strictEqual(lan.isLanBound('0.0.0.0'), true);
assert.strictEqual(lan.isLanBound('127.0.0.1'), false);
assert.strictEqual(lan.isLanBound('localhost'), false);
assert.strictEqual(lan.isLoopbackHost('127.0.0.1'), true);
assert.strictEqual(lan.isLoopbackHost('0.0.0.0'), false);

lan.setListenInfo({ host: '0.0.0.0', port: 4000 });
assert.deepStrictEqual(lan.getListenInfo(), { host: '0.0.0.0', port: 4000 });
assert.strictEqual(lan.resolvePort(), 4000);

console.log('lan tests ok');
