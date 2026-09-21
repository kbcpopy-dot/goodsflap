import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';

test('상품 조회 실패 시 기본 상품을 노출하지 않고 복구 후 확인한 상품만 재사용한다', async () => {
  let attempts = 0, failing = true;
  const upstream = createServer((req, res) => {
    if (req.url?.startsWith('/rest/v1/catalog_products')) {
      attempts += 1;
      if(!failing){res.writeHead(200, {'Content-Type':'application/json'}).end(JSON.stringify([{id:'postcard',visible:true,sort_order:0,body:{name:'현재 아트 엽서',price:3000,thumbnailImage:'/media/current.png'}}]));return;}
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
    assert.equal(response.status, 503);
    assert.equal(catalog.products, undefined);
    assert.match(response.headers.get("cache-control"), /no-store/);
    assert.equal(attempts, 3);
    failing=false;
    const recovered=await fetch(`http://127.0.0.1:${appPort}/api/catalog`);
    const good=await recovered.json();
    assert.equal(recovered.status,200);
    assert.match(recovered.headers.get('cache-control'),/no-store/);
    assert.equal(good.products.find(p=>p.id==='postcard').price,3000);
    assert.equal(good.products.find(p=>p.id==='postcard').thumbnailImage,'/media/current.png');
    failing=true;
    const warm=await fetch(`http://127.0.0.1:${appPort}/api/catalog`);
    assert.equal(warm.status,200);
    assert.deepEqual((await warm.json()).products,good.products);
  } finally {
    child.kill();
    await new Promise(resolve => upstream.close(resolve));
  }
});
