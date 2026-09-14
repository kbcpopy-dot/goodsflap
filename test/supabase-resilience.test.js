import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';

test('Supabase가 일시적으로 502를 반환해도 공개 상품 목록을 제공한다', async () => {
  let attempts = 0;
  const upstream = createServer((req, res) => {
    if (req.url?.startsWith('/rest/v1/catalog_products')) {
      attempts += 1;
      res.writeHead(502, {'Content-Type': 'text/plain'}).end('Bad Gateway');
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamPort = upstream.address().port;
  const appPort = 32000 + (process.pid % 1000);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      PORT: String(appPort),
      PUBLIC_URL: 'https://artell.co.kr',
      ADMIN_TOKEN: 'resilience-test-admin',
      SUPABASE_URL: `http://127.0.0.1:${upstreamPort}`,
      SUPABASE_SERVICE_ROLE_KEY: 'resilience-test-service-role',
      SUPABASE_PUBLISHABLE_KEY: '',
      TOSS_CLIENT_KEY: '',
      TOSS_SECRET_KEY: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('서버 시작 시간 초과')), 15000);
      child.stdout.on('data', chunk => {
        if (chunk.toString().includes('굿즈플랩 스튜디오:')) { clearTimeout(timer); resolve(); }
      });
      child.on('error', reject);
    });
    const response = await fetch(`http://127.0.0.1:${appPort}/api/catalog`);
    const catalog = await response.json();
    assert.equal(response.status, 200);
    assert.equal(catalog.products.length, 12);
    assert.equal(attempts, 3);
  } finally {
    child.kill();
    await new Promise(resolve => upstream.close(resolve));
  }
});
