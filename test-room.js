/* 0.2alpha 房间功能集成测试 —— 起真实 HTTP 服务端跑完整流程 */
'use strict';
const http = require('http');
const srv = require('./serve.js').createServer();

let fails = 0, PORT = 0;
const sec = t => console.log('\n=== ' + t + ' ===');
function eq(a, e, m) {
  const x = JSON.stringify(a), y = JSON.stringify(e);
  if (x !== y) { console.log('  FAIL ' + m + '\n     实际 ' + x + '\n     期望 ' + y); fails++; }
  else console.log('  ok   ' + m + '  = ' + x);
}
function ok(v, m) { if (!v) { console.log('  FAIL ' + m); fails++; } else console.log('  ok   ' + m); }

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, method: method, path: path,
      headers: body ? { 'Content-Type': 'application/json' } : {} }, resp => {
      let d = '';
      resp.on('data', c => d += c);
      resp.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}
let ROOM = '';   // 当前被测房间号
const st = m => req('GET', '/api/state?code=' + (m.code || ROOM) + '&token=' + (m.token || m) + '&rev=-1');
const act = (m, payload) => req('POST', '/api/action?code=' + (m.code || ROOM) + '&token=' + (m.token || m), payload);
const create = name => req('POST', '/api/create', { name: name });
const join = (code, name) => req('POST', '/api/join', { code: code, name: name });
const total = v => v.state.players.reduce((s, p) => s + p.chips + p.street, 0) + v.state.pot;

(async function () {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  PORT = srv.address().port;

  sec('1. 创建房间：得到 6 位房间号 + 临时ID + 房主身份');
  const host = await create('房主老王');
  eq(host.ok, true, '创建成功');
  eq(/^\d{6}$/.test(host.code), true, '房间号是 6 位数字');
  eq(host.me.name, '房主老王', '临时ID 生效');
  eq(host.isHost, true, '创建者就是房主');
  eq(host.started, false, '创建后还没开局');
  eq(host.state, null, '开局前没有牌局状态');
  eq(host.players.length, 1, '房间里只有房主自己');
  eq(host.token.length, 32, '拿到临时凭证 token');

  sec('2. 加入房间：输入房间号 + 创建自己的临时ID');
  eq((await create('')).ok, false, '空临时ID 被拒');
  eq((await join('999999', '小李')).ok, false, '房间号不存在 -> 拒绝');
  ROOM = host.code;
  const p2 = await join(host.code, '小李');
  eq(p2.ok, true, '小李加入成功');
  eq(p2.isHost, false, '小李不是房主');
  eq(p2.me.pid, 1, '小李拿到 2 号位');
  eq(p2.players.length, 2, '房间现在 2 人');
  const p3 = await join(host.code, '小张');
  eq(p3.ok, true, '小张加入成功');
  // 自己保管每个人的 token（服务端不会泄露别人的 token）
  const TOK = { 0: host.token, 1: p2.token, 2: p3.token };
  eq((await join(host.code, '小李')).ok, false, '重名被拒');
  eq((await join(host.code + 'x', '小赵')).ok, false, '错误房间号被拒');
  eq((await req('GET', '/api/state?code=' + host.code + '&token=bogus&rev=-1')).ok, false, '伪造 token 被拒');

  sec('3. 人数上限：满了就进不来');
  const h2 = await create('上限房主');
  ROOM = h2.code;
  await join(h2.code, '甲'); await join(h2.code, '乙'); await join(h2.code, '丙');
  eq((await join(h2.code, '丁')).ok, true, '5 人（含房主）时还能进');
  eq((await join(h2.code, '戊')).ok, true, '第 6 人进来，刚好满员');
  eq((await join(h2.code, '己')).ok, false, '第 7 人 -> 房间已满，拒绝');
  eq((await act(h2, { action: 'setup', cfg: { count: 2 } })).ok, false, '人数上限不能小于已加入人数');

  ROOM = host.code;   // 回到主测房间
  sec('4. 非房主不能开局 / 不能改设置');
  eq((await act(p2, { action: 'start', cfg: { count: 6, buyin: 500, sb: 5, bb: 10 } })).ok, false, '小李不能开局');
  eq((await act(p2, { action: 'setup', cfg: { sb: 20 } })).ok, false, '小李不能改设置');
  eq((await act(p2, { action: 'undo' })).ok, false, '小李不能撤销');
  eq((await act(p2, { action: 'next' })).ok, false, '小李不能推下一手');

  sec('5. 房主开局：按加入顺序排座，带入筹码生效');
  const started = await act(host, { action: 'start', cfg: { count: 6, buyin: 500, sb: 5, bb: 10, straddleSeat: -1 } });
  eq(started.ok, true, '房主开局成功');
  eq(started.started, true, '房间进入 started');
  eq(started.state.players.length, 3, '3 人上桌');
  eq(started.state.players.map(p => p.name), ['房主老王', '小李', '小张'], '座位顺序 = 加入顺序');
  eq(started.state.players.map(p => p.chips).reduce((a, b) => a + b, 0), 1485, '买入 1500，盲注 5+10 已扣 -> 手上 1485');
  eq(total(started), 1500, '总筹码守恒 1500');
  eq(started.state.phase, 'playing', '进入进行中');
  eq(started.state.handNo, 1, '第 1 手');

  sec('6. 只有轮到的人能操作');
  const seatPid = id => started.state.players[id].pid;
  const cur = started.state.current;
  const me = TOK[seatPid(cur)];
  const notMe = TOK[seatPid((cur + 1) % 3)];
  eq((await act(notMe, { action: 'commit', amount: 60 })).ok, false, '没轮到的人下注被拒');
  eq((await act(notMe, { action: 'fold' })).ok, false, '没轮到的人弃牌被拒');
  const bad = await act(notMe, { action: 'commit', amount: 60 });
  ok(/轮到你/.test(bad.msg), '拒绝理由提示「还没轮到你」');
  const curState = await st(me);
  eq(curState.canAct, true, '轮到的人 canAct=true');
  const otherState = await st(notMe);
  eq(otherState.canAct, false, '没轮到的人 canAct=false');
  eq(otherState.options, null, '没轮到的人拿不到下注选项');

  sec('7. 轮到的人可以正常下注，筹码守恒');
  const before = total(curState);
  const afterBet = await act(me, { action: 'commit', amount: 40 });
  eq(afterBet.ok, true, '当前行动者下注成功');
  eq(total(afterBet), before, '下注后总筹码守恒');
  eq(afterBet.rev > curState.rev, true, 'rev 递增（其他人能收到推送）');
  const pollSame = await req('GET', '/api/state?code=' + host.code + '&token=' + host.token + '&rev=' + afterBet.rev);
  eq(pollSame.same, true, 'rev 相同 -> 返回 same，不重复推全量');

  sec('8. 走到摊牌：只有房主能确认胜负');
  let guard = 0, v = afterBet;
  while (v.state.phase === 'playing' && guard++ < 60) {
    const t = TOK[seatPid(v.state.current)];
    const r = await act(t, { action: 'fold' });
    if (!r.ok) { console.log('  FAIL 弃牌失败: ' + r.msg); fails++; break; }
    v = r;
  }
  eq(v.state.phase, 'showdown', '走到摊牌');
  eq((await act(notMe, { action: 'confirmWin', winners: [[0]] })).ok, false, '非房主确认胜负被拒');
  eq((await act(notMe, { action: 'forceFold' })).ok, false, '非房主不能代弃牌');
  eq((await act(notMe, { action: 'setup', cfg: { sb: 20 } })).ok, false, '摊牌时非房主仍不能改设置');

  sec('9. 房主确认胜负 -> 底池给胜者，筹码守恒');
  const potBefore = v.state.pot;
  ok(potBefore > 0, '摊牌时底池 ' + potBefore + ' > 0');
  const winners = v.state.pots.map(p => [p.eligible[0]]);
  const win = await act(host, { action: 'confirmWin', winners: winners });
  eq(win.ok, true, '房主确认成功');
  eq(win.state.pot, 0, '结算后底池清零');
  eq(win.state.pots.length, 0, '结算后池列表清空');
  eq(total(win), 1500, '结算后总筹码守恒 1500');
  const chips = win.state.players.map(p => p.chips);
  ok(chips.reduce((a, b) => a + b, 0) === 1500, '每人筹码加起来 = 1500');
  eq(win.state.phase, 'showdown', '结算后仍停在 showdown（等点下一手）');

  sec('10. 房主推下一手 -> 回到进行中');
  eq((await act(notMe, { action: 'next' })).ok, false, '非房主不能推下一手');
  const n2 = await act(host, { action: 'next' });
  eq(n2.ok, true, '房主推下一手成功');
  eq(n2.state.phase, 'playing', '回到进行中');
  eq(n2.state.handNo, 2, '手数到 2');
  eq(total(n2), 1500, '第二手开始前筹码守恒');

  sec('11. 中途加入 -> 候补席，下一手上桌');
  const late = await join(host.code, '中途来的小王');
  eq(late.ok, true, '牌局进行中还能加入');
  eq(late.me.seat, -1, '新来的还没座位');
  eq(late.state.bench.length, 1, '进了候补席');

  sec('12. 房主代弃牌（对方掉线时救场）');
  eq((await act(notMe, { action: 'forceFold' })).ok, false, '非房主不能代弃牌');
  const ff = await act(host, { action: 'forceFold' });
  eq(ff.ok, true, '房主代当前行动者弃牌成功');

  sec('13. 房间内不能中途退出；开局前可以退出');
  eq((await act(host, { action: 'leave' })).ok, false, '牌局进行中不能退出');
  const h3 = await create('会走的房主');
  ROOM = h3.code;
  const g1 = await join(h3.code, '路人甲');
  const lv = await act(g1, { action: 'leave' });
  eq(lv.ok, true, '开局前可以退出');
  eq(lv.gone, true, '退出后返回 gone');
  const afterLeave = await st(h3);
  eq(afterLeave.ok, true, '房间还在');
  eq(afterLeave.players.length, 1, '退出后只剩房主');

  sec('14. 静态页面与脚本仍可访问');
  const home = await new Promise((res, rej) => {
    http.get('http://127.0.0.1:' + PORT + '/', r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res({ code: r.statusCode, len: d.length })); }).on('error', rej);
  });
  eq(home.code, 200, 'index.html 可访问');
  ok(home.len > 1000, '页面有内容 (' + home.len + ' 字节)');

  console.log('\n' + (fails ? 'X ' + fails + ' 项失败' : '全部通过'));
  srv.close();
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
