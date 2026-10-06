/* Cloudflare 版集成测试：在 Node 里跑真实的 worker.mjs + RoomStore
   （用内存对象模拟 Durable Object 的 storage / 静态资源绑定） */
'use strict';
let fails = 0;
const sec = t => console.log('\n=== ' + t + ' ===');
function eq(a, e, m) {
  const x = JSON.stringify(a), y = JSON.stringify(e);
  if (x !== y) { console.log('  FAIL ' + m + '\n     实际 ' + x + '\n     期望 ' + y); fails++; }
  else console.log('  ok   ' + m + '  = ' + x);
}
function ok(v, m) { if (!v) { console.log('  FAIL ' + m); fails++; } else console.log('  ok   ' + m); }

(async function () {
  const mod = await import('./worker.mjs');
  const worker = mod.default;
  const RoomStore = mod.RoomStore;
  ok(typeof worker.fetch === 'function', 'Worker 默认导出有 fetch');
  ok(typeof RoomStore === 'function', '导出了 Durable Object 类 RoomStore');

  /* --- 内存版 Durable Object storage --- */
  const disk = new Map();
  const storage = {
    get: async k => (disk.has(k) ? JSON.parse(disk.get(k)) : undefined),
    put: async (k, v) => { disk.set(k, JSON.stringify(v)); },
  };
  let doInstance = new RoomStore({ storage: storage }, {});

  const assetHits = [];
  const env = {
    ROOMS: { idFromName: n => n, get: () => ({ fetch: req => doInstance.fetch(req) }) },
    ASSETS: { fetch: async req => { assetHits.push(new URL(req.url).pathname); return new Response('ASSET:' + new URL(req.url).pathname, { status: 200 }); } },
  };
  const BASE = 'https://texas-bet.example.workers.dev';
  const get = p => worker.fetch(new Request(BASE + p), env);
  const post = (p, body) => worker.fetch(new Request(BASE + p, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
  }), env);
  const j = async r => ({ status: r.status, cors: r.headers.get('access-control-allow-origin'), body: await r.json() });

  sec('1. 探测与静态资源路由');
  let r = await j(await get('/api/ping'));
  eq(r.status, 200, 'GET /api/ping -> 200');
  eq(r.body.ok, true, '/api/ping 返回 ok');
  eq(r.body.ver, '0.25alpha', '版本号 0.25alpha');
  eq(r.cors, '*', 'API 响应带 CORS');
  r = await j(await get('/api/nope'));
  eq(r.body.ok, false, '未知接口 -> ok:false');
  r = await worker.fetch(new Request(BASE + '/index.html'), env);
  eq(await r.text(), 'ASSET:/index.html', '非 /api 路径交给静态资源');
  r = await worker.fetch(new Request(BASE + '/api/ping', { method: 'OPTIONS' }), env);
  eq(r.status, 204, 'OPTIONS 预检 -> 204');
  eq(r.headers.get('access-control-allow-origin'), '*', '预检带 CORS');

  sec('2. 创建 / 加入房间');
  let host = (await j(await post('/api/create', { name: 'CF 房主' }))).body;
  eq(host.ok, true, '创建房间成功');
  eq(/^\d{6}$/.test(host.code), true, '房间号 6 位');
  eq(host.isHost, true, '创建者是房主');
  let guest = (await j(await post('/api/join', { code: host.code, name: 'CF 小李' }))).body;
  eq(guest.ok, true, '加入成功');
  eq(guest.isHost, false, '加入者不是房主');
  eq((await j(await post('/api/join', { code: host.code, name: 'CF 小李' }))).body.ok, false, '重名被拒');
  eq((await j(await post('/api/join', { code: '000000', name: 'X' }))).body.ok, false, '错房间号被拒');

  const S = (code, token) => get('/api/state?code=' + code + '&token=' + token + '&rev=-1');
  const A = (code, token, body) => post('/api/action?code=' + code + '&token=' + token, body);

  sec('3. 非房主不能开局；房主开局后排座正确');
  eq((await j(await A(host.code, guest.token, { action: 'start', cfg: { count: 6, buyin: 500, sb: 5, bb: 10, straddleSeat: -1 } }))).body.ok, false, '非房主开局被拒');
  let v = (await j(await A(host.code, host.token, { action: 'start', cfg: { count: 6, buyin: 500, sb: 5, bb: 10, straddleSeat: -1 } }))).body;
  eq(v.ok, true, '房主开局成功');
  eq(v.started, true, '进入 started');
  eq(v.state.players.map(p => p.name), ['CF 房主', 'CF 小李'], '座位顺序 = 加入顺序');
  eq(v.state.phase, 'playing', '进入进行中');
  const total = x => x.state.players.reduce((s, p) => s + p.chips + p.street, 0) + x.state.pot;
  eq(total(v), 1000, '总筹码守恒 1000');

  sec('4. 只有轮到的人能操作（服务端强制）');
  const TOK = { [host.me.pid]: host.token, [guest.me.pid]: guest.token };
  const seatPid = x => x.state.players[x.state.current].pid;
  const meTok = TOK[seatPid(v)], otherTok = TOK[seatPid(v) === host.me.pid ? guest.me.pid : host.me.pid];
  const bad = (await j(await A(host.code, otherTok, { action: 'commit', amount: 60 }))).body;
  eq(bad.ok, false, '没轮到的人下注被拒');
  eq(bad.msg, '还没轮到你', '拒绝理由：还没轮到你');
  eq((await j(await S(host.code, otherTok))).body.canAct, false, '没轮到的人 canAct=false');
  eq((await j(await S(host.code, otherTok))).body.options, null, '没轮到的人拿不到下注选项');
  eq((await j(await S(host.code, meTok))).body.canAct, true, '轮到的人 canAct=true');

  sec('5. 下注 -> 走到摊牌 -> 只有房主能确认 -> 下一手');
  const before = total(v);
  v = (await j(await A(host.code, meTok, { action: 'commit', amount: 40 }))).body;
  eq(v.ok, true, '当前行动者下注成功');
  eq(total(v), before, '下注后筹码守恒');
  let guard = 0;
  while (v.state.phase === 'playing' && guard++ < 60) {
    v = (await j(await A(host.code, TOK[seatPid(v)], { action: 'fold' }))).body;
    if (!v.ok) { console.log('  FAIL 弃牌失败: ' + v.msg); fails++; break; }
  }
  eq(v.state.phase, 'showdown', '走到摊牌');
  const winners = v.state.pots.map(p => [p.eligible[0]]);
  eq((await j(await A(host.code, guest.token, { action: 'confirmWin', winners }))).body.ok, false, '非房主确认胜负被拒');
  v = (await j(await A(host.code, host.token, { action: 'confirmWin', winners }))).body;
  eq(v.ok, true, '房主确认成功');
  eq(v.state.pots.length, 0, '结算后池清空（客户端此时出现「下一手」）');
  eq(total(v), 1000, '结算后筹码守恒');
  eq((await j(await A(host.code, guest.token, { action: 'next' }))).body.ok, false, '非房主不能推下一手');
  v = (await j(await A(host.code, host.token, { action: 'next' }))).body;
  eq(v.ok, true, '房主推下一手成功');
  eq(v.state.handNo, 2, '手数到 2');

  sec('6. Durable Object 持久化：换个实例房间还在');
  ok(disk.has('rooms'), '已经落盘到 DO storage');
  const saved = JSON.parse(disk.get('rooms'));
  const savedRoom = saved[host.code];
  ok(!!savedRoom, '房间 ' + host.code + ' 在存储里');
  eq(savedRoom.started, true, 'started 已持久化');
  eq(savedRoom.state.handNo, 2, '手数已持久化');
  eq(savedRoom.state.history, undefined, 'history 快照不落盘（避免撑爆存储）');
  // 模拟 DO 被回收后重建
  doInstance = new RoomStore({ storage: storage }, {});
  const again = (await j(await S(host.code, guest.token))).body;
  eq(again.ok, true, 'DO 重建后原 token 仍可用');
  eq(again.state.handNo, 2, 'DO 重建后牌局状态还在');
  eq(again.started, true, 'DO 重建后仍是已开局');

  sec('7. 轮询 rev 去重 + 退出房间');
  const rev = again.rev;
  eq((await j(await get('/api/state?code=' + host.code + '&token=' + guest.token + '&rev=' + rev))).body.same, true, 'rev 相同 -> 只回 same');
  eq((await j(await A(host.code, guest.token, { action: 'leave' }))).body.ok, false, '牌局进行中不能退出');
  const lobby = (await j(await post('/api/create', { name: '要走的人' }))).body;
  eq((await j(await A(lobby.code, lobby.token, { action: 'leave' }))).body.gone, true, '开局前可以退出');

  sec('8. 房间回收 sweep');
  const coreMod = require('./room-core.js')(require('./engine.js'));
  const c = (await j(await post('/api/create', { name: 'x' }))).body;   // 走 worker，不影响下面
  ok(Array.isArray([].concat(1)), '占位');
  coreMod.rooms.set('999999', { touched: Date.now() - 13 * 3600 * 1000, players: [], cfg: {}, rev: 1 });
  coreMod.rooms.set('888888', { touched: Date.now(), players: [], cfg: {}, rev: 1 });
  coreMod.sweep();
  eq(coreMod.rooms.has('999999'), false, '13 小时无活动的房间被回收');
  eq(coreMod.rooms.has('888888'), true, '活跃房间保留');

  console.log('\n' + (fails ? 'X ' + fails + ' 项失败' : '全部通过'));
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
