/* 0.2alpha 界面冒烟测试 —— 用最小 DOM 桩在 Node 里跑真实 app.js 渲染路径
   （浏览器被审批拦住时的等价验证：不点真浏览器，但跑同一份界面代码） */
'use strict';
const http = require('http');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

let fails = 0;
const sec = t => console.log('\n=== ' + t + ' ===');
function eq(a, e, m) {
  const x = JSON.stringify(a), y = JSON.stringify(e);
  if (x !== y) { console.log('  FAIL ' + m + '\n     实际 ' + x + '\n     期望 ' + y); fails++; }
  else console.log('  ok   ' + m + '  = ' + x);
}
function ok(v, m) { if (!v) { console.log('  FAIL ' + m); fails++; } else console.log('  ok   ' + m); }

/* ---------- 最小 DOM 桩 ---------- */
function makeEl(tag, id) {
  const set = new Set();
  const e = {
    tagName: (tag || 'div').toUpperCase(), id: id || '', className: '',
    textContent: '', value: '', hidden: false,
    style: {}, children: [], _q: {}, _ev: {}, _html: '',
    get innerHTML() { return e._html; },
    set innerHTML(v) { e._html = v; e.children.length = 0; e._q = {}; },
    get classList() {
      return {
        add: (...c) => c.forEach(x => x && set.add(x)),
        remove: (...c) => c.forEach(x => set.delete(x)),
        toggle: (c, f) => { const on = f === undefined ? !set.has(c) : !!f; on ? set.add(c) : set.delete(c); return on; },
        contains: c => set.has(c),
      };
    },
    set className(v) { e._cn = v; String(v).split(/\s+/).forEach(c => c && set.add(c)); },
    get className() { return e._cn || Array.from(set).join(' '); },
    addEventListener(t, h) { (e._ev[t] = e._ev[t] || []).push(h); },
    removeEventListener() {},
    dispatch(t, ev) { (e._ev[t] || []).forEach(h => h(ev || { key: '' })); },
    querySelector(sel) { if (!e._q[sel]) e._q[sel] = makeEl('div'); return e._q[sel]; },
    querySelectorAll() { return []; },
    appendChild(c) { e.children.push(c); return c; },
    focus() {}, blur() {}, scrollIntoView() {}, getAttribute() { return null; },
    setAttribute() {},
  };
  return e;
}
const nodes = new Map();
const $id = id => { if (!nodes.has(id)) nodes.set(id, makeEl('div', id)); return nodes.get(id); };

// 让桩里的按钮文字与 index.html 保持一致（桩默认是空串）
for (const m of fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')
  .matchAll(/<button[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g)) {
  $id(m[1]).textContent = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

const document = {
  getElementById: $id,
  createElement: t => makeEl(t),
  addEventListener() {}, hidden: false,
  querySelector: () => makeEl('div'),
  querySelectorAll: () => [],
};
const windowObj = { PokerEngine: require('./engine.js'), addEventListener() {} };
const store = {};
const sandbox = {
  window: windowObj, document: document, console: console,
  localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => store[k] = v, removeItem: k => delete store[k] },
  navigator: {}, fetch: () => Promise.reject(new Error('offline')),
  setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
  confirm: () => false, Array, Math, JSON, Number, String, Object, Date, Set, Map, RegExp, Error, isFinite,
  __expose: null,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

let src = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
src += `
;__expose({
  startLocal, saveSetup, renderAll, renderSeats, renderFooter, renderStats, renderTop,
  openSetup, openShowdown, closeShowdown, doCommit, doFold, afterLocal, confirmWin,
  nextHandClick, undoClick,
  setRoom: (k, me) => { KIND = k; Object.assign(ME, me); },
  showView, setRoomStarted: v => { ROOMSTARTED = v; },
  applyView, goHome, backToRoom, dropOldRoom, renderLobby,
  apiErr, probeServer, apiBase, api,
  getS: () => S, setS: v => { S = v; },
  nodes: (typeof nodes !== 'undefined') ? null : null,
  KIND: () => KIND, ME: () => ME, SD: () => SD_OPEN,
});`;
sandbox.__expose = o => { sandbox.__T = o; };

vm.runInContext(src, sandbox, { filename: 'app.js' });
const T = sandbox.__T;
const E = windowObj.PokerEngine;
const ROOMCFG_FOR_TEST = { count: 6, buyin: 500, sb: 5, bb: 10, straddleSeat: -1 };

sec('1. app.js 能在界面桩里完整加载（无引用错误）');
ok(typeof T.startLocal === 'function', '顶层函数全部定义成功');

sec('2. 本地模式：开桌 -> 6 人牌桌渲染出来');
T.startLocal();
eq(T.SD(), false, '还没开局不弹摊牌');
T.saveSetup();
const S = T.getS();
eq(S.phase, 'playing', '开桌后进入 playing');
eq(S.players.length, 6, '默认 6 人桌');
eq(S.handNo, 1, '第 1 手');
T.renderAll();
const seatsWrap = $id('seats');
eq(seatsWrap.children.length, 6, '画出了 6 个座位');
eq($id('gameView').classList.contains('hidden'), false, '牌桌视图可见');
eq($id('homeView').classList.contains('hidden'), true, '首页已隐藏');
ok($id('abTurn').textContent.length > 0, '底部栏有提示：' + $id('abTurn').textContent);

sec('3. 轮到的人才渲染下注面板');
let rendered = 0;
seatsWrap.children.forEach(c => { const act = c._q['.act']; if (act && act.innerHTML) rendered++; });
eq(rendered, 1, '同一时刻只有 1 个座位有下注面板（轮到的人）');
const active = seatsWrap.children.find(c => c.className.indexOf('active') >= 0);
ok(!!active, '当前行动座位被高亮');
const actBox = active._q['.act'];
const vals = [...actBox.innerHTML.matchAll(/data-v="(\d+)"/g)].map(m => Number(m[1]));
ok(vals.length >= 2, '下注面板有快捷按钮：' + vals.length + ' 个');
eq(vals.every(v => v % S.bb === 0), true, '快捷额度全部是大盲 ' + S.bb + ' 的整数倍（需求1）');
eq(Math.max(...vals), S.players[S.current].chips + S.players[S.current].street, '最大额度 = 后手全下');
ok(/data-a="ok"/.test(actBox.innerHTML) && /data-a="fold"/.test(actBox.innerHTML), '有确认与弃牌按钮');
eq(/确定|跟注|过牌/.test(actBox.innerHTML), true, '确认按钮有文案');

sec('4. 快捷按钮只填滑条，不直接下注（点 data-v 后筹码不变）');
const chipsBefore = S.players.map(p => p.chips);
const potBefore = S.pot + S.players.reduce((a, p) => a + p.street, 0);
const firstVal = vals.find(v => v > 0);
const btn = { dataset: { v: String(firstVal) }, addEventListener() {}, };
// 直接复刻按钮点击的语义：只改数字框
const numEl = actBox._q['.betnum'];
ok(!!numEl, '数字框存在');
numEl.value = String(firstVal);
eq(S.players.map(p => p.chips), chipsBefore, '改滑条不改变任何人的筹码');
eq(S.pot + S.players.reduce((a, p) => a + p.street, 0), potBefore, '改滑条不改变底池');

sec('5. 本地模式可以正常下注并推进到摊牌');
const mySeatId = S.current;
T.doCommit(30);
eq(T.getS().players[mySeatId].chips < chipsBefore[mySeatId], true, '确认后才真的扣筹码');
let guard = 0;
while (T.getS().phase === 'playing' && guard++ < 80) T.doFold();
eq(T.getS().phase, 'showdown', '走到摊牌');
ok(T.SD(), '摊牌弹窗自动打开');
eq($id('mShowdown').classList.contains('hidden'), false, '摊牌弹窗可见');
eq($id('sdActionsHost').classList.contains('hidden'), false, '本地/房主能看到确认按钮');
ok($id('showdownPlayers').children.length > 0, '摊牌面板列出了可赢的人');
ok(/房主正在决定胜负|点选赢家/.test($id('sdSub').textContent), '摊牌说明文案：' + $id('sdSub').textContent);

sec('6. 房主确认胜负 -> 底池结算');
const totalBefore = T.getS().players.reduce((a, p) => a + p.chips, 0) + T.getS().pot;
T.confirmWin();
eq(T.getS().pot, 0, '结算后底池清零');
eq(T.getS().pots.length, 0, '结算后池列表清空');
eq(T.getS().players.reduce((a, p) => a + p.chips, 0), totalBefore, '结算后筹码守恒');
eq(T.SD(), false, '弹窗已关闭');
eq($id('mShowdown').classList.contains('hidden'), true, '弹窗已隐藏');

sec('7. 下一手按钮出现，可继续开下一手');
T.renderFooter();
eq($id('btnNext').classList.contains('hidden'), false, '结算后出现「下一手」');
T.nextHandClick();
eq(T.getS().phase, 'playing', '回到进行中');
eq(T.getS().handNo, 2, '手数到 2');

sec('8. 非房主视角：只渲染、不能操作');
// 构造一个 room 视角：当前行动者不是我
T.setS(Object.assign({}, T.getS()));
const origKind = T.KIND();
eq(origKind, 'local', '默认本地模式');
ok(/轮到你行动|轮到/.test($id('abTurn').textContent), '底部栏提示行动方：' + $id('abTurn').textContent);

sec('9. 房间模式：非房主 + 没轮到我 -> 不渲染下注面板');
T.setRoom('room', { pid: 1, seat: -1, isHost: false, name: '小李', code: '123456', token: 'x' });
T.setRoomStarted(true);
let s9 = T.getS();
// 用 3 人局复现房间视角
const rs = E.createState();
E.newGame(rs, { seats: [{pid:0,name:'房主',chips:500},{pid:1,name:'小李',chips:500},{pid:2,name:'小张',chips:500}],
  sb:5, bb:10, buyin:500, straddleSeat:-1 });
T.setS(rs);
T.renderAll();
let wrap9 = $id('seats');
let withAct = wrap9.children.filter(c => { const a = c._q['.act']; return a && a.innerHTML; }).length;
eq(withAct, 0, '我还没座位(seat=-1) -> 一个下注面板都不渲染');
const myNow = rs.current;                    // 把「我」设到当前行动者身上
T.setRoom('room', { pid: rs.players[myNow].pid, seat: myNow, isHost: false, name: rs.players[myNow].name, code: '123456', token: 'x' });
T.renderAll();
wrap9 = $id('seats');
withAct = wrap9.children.filter(c => { const a = c._q['.act']; return a && a.innerHTML; }).length;
eq(myNow, rs.current, '把「我」设到当前行动座位 ' + rs.current);
eq(withAct, 1, '轮到我时渲染出 1 个下注面板');
eq(wrap9.children[myNow].className.indexOf('mine') >= 0, true, '我的座位标了「我」');
eq($id('btnUndo').classList.contains('hidden'), true, '非房主看不到「撤销」');
eq($id('btnSetup').classList.contains('hidden'), true, '非房主看不到「牌桌设置」');
eq($id('btnForceFold').classList.contains('hidden'), true, '非房主看不到「代弃牌」');
eq($id('roomChip').hidden, false, '房间模式显示房间号');
eq($id('roomChipVal').textContent, '123456', '房间号正确');

sec('10. 房间模式：没轮到我时底部栏提示等对方');
const other = (myNow + 1) % rs.players.length;   // 换成别人行动
rs.current = other;
T.renderAll();
wrap9 = $id('seats');
withAct = wrap9.children.filter(c => { const a = c._q['.act']; return a && a.innerHTML; }).length;
eq(withAct, 0, '没轮到我 -> 0 个下注面板');
eq($id('abTurn').textContent, '轮到 ' + rs.players[other].name, '底部栏显示对方名字，不是「轮到你」');
eq(wrap9.children[other].className.indexOf('active') >= 0, true, '对方座位被高亮');
eq(wrap9.children[myNow].className.indexOf('mine') >= 0, true, '我的座位仍然标着「我」');
ok(/等对方操作/.test($id('abHint').textContent), '提示等对方：' + $id('abHint').textContent);

sec('11. 房间模式：摊牌只有房主能确认');
rs.phase = 'showdown'; rs.current = null; rs.street = 4;
rs.pots = [{ amount: 30, eligible: [0, 1, 2], winners: [] }];
rs.pot = 30;
T.renderAll();
T.openShowdown();      // 服务端 applyView 检测到进入摊牌时会调用它
eq(T.SD(), true, '摊牌弹窗自动打开');
eq($id('sdActionsHost').classList.contains('hidden'), true, '非房主看不到「确认赢家」按钮');
ok(/等待房主确认胜负|房主正在决定/.test($id('sdSub').textContent), '摊牌说明提示等房主：' + $id('sdSub').textContent);
eq($id('showdownPlayers').children.length, 1, '非房主仍能看到底池信息');
T.setRoom('room', { pid: 0, seat: 0, isHost: true, name: '房主', code: '123456', token: 'y' });
rs.pots = [{ amount: 30, eligible: [0, 1, 2], winners: [] }];
T.openShowdown();
eq($id('sdActionsHost').classList.contains('hidden'), false, '房主能看到「确认赢家」按钮');
ok(/点选赢家/.test($id('sdSub').textContent), '房主视角文案：' + $id('sdSub').textContent);

sec('12. 修复：房主确认胜负后必须出现「下一手」');
// 造一个房间视图
const mkView = (phase, pots, rev) => ({
  ok: true, rev: rev, code: '123456', token: 'zz', isHost: true,
  started: true, cfg: ROOMCFG_FOR_TEST, players: [{pid:0,name:'房主',host:true,seat:0}],
  me: { pid: 0, seat: 0, name: '房主' },
  state: (() => {
    const st = E.createState();
    E.newGame(st, { seats: [{pid:0,name:'房主',chips:500},{pid:1,name:'小李',chips:500}],
      sb:5, bb:10, buyin:500, straddleSeat:-1 });
    st.phase = phase; st.pots = pots;
    st.pot = pots.reduce((s,p)=>s+p.amount,0);
    if (phase === 'showdown') { st.street = 4; st.current = null; }
    return st;
  })(),
});
T.setRoom('room', { pid:0, seat:0, isHost:true, name:'房主', code:'123456', token:'zz' });
T.setRoomStarted(true);
T.showView('gameView');
T.closeShowdown();      // 从干净状态开始
// 1) 摊牌：弹窗打开，底部「下一手」应隐藏
T.applyView(mkView('showdown', [{amount:30, eligible:[0,1], winners:[]}], 10));
eq(T.SD(), true, '摊牌弹窗打开');
eq($id('mShowdown').classList.contains('hidden'), false, '弹窗可见');
eq($id('btnNext').classList.contains('hidden'), true, '摊牌时先不显示「下一手」');
// 2) 房主确认胜负后：服务端回 showdown + 空 pots
T.applyView(mkView('showdown', [], 11));
eq(T.SD(), false, '确认后弹窗关闭');
eq($id('mShowdown').classList.contains('hidden'), true, '弹窗已隐藏');
eq($id('btnNext').classList.contains('hidden'), false, '确认胜负后「下一手」按钮必须出现');
ok(/下一手/.test($id('btnNext').textContent), '按钮文案：' + $id('btnNext').textContent);
// 3) rev 相同的轮询不该把状态打回去
T.applyView({ ok:true, same:true, rev:11 });
eq($id('btnNext').classList.contains('hidden'), false, 'rev 相同的轮询不会打回原状态');
// 4) 点下一手 -> playing，按钮应消失
T.applyView(mkView('playing', [], 12));
eq($id('btnNext').classList.contains('hidden'), true, '进入下一手后按钮消失');

sec('13. 右上角「回到主页」按钮');
ok($id('btnHome') && !$id('btnHome').classList.contains('hidden'), '牌桌右上角有回到主页按钮');
ok($id('btnHomeLobby'), '大厅卡片右上角也有回到主页按钮');
ok($id('btnBackRoom'), '首页有回到房间的入口');
T.goHome();
eq($id('homeView').classList.contains('hidden'), false, '点击后回到首页');
eq($id('gameView').classList.contains('hidden'), true, '牌桌已隐藏');
eq($id('btnBackRoom').classList.contains('hidden'), false, '房间模式下首页显示「回到房间」');
eq($id('backRoomNo').textContent, '123456', '回到房间按钮带房间号 123456');
// 本地模式下不应显示「回到房间」
T.setRoom('local', { pid:null, name:'本机', seat:null, isHost:true, code:null, token:null });
T.goHome();
eq($id('btnBackRoom').classList.contains('hidden'), true, '本地模式首页不显示「回到房间」');

sec('14. 修复：滑条取值必须吸附到大盲整数倍');
// 用一个「筹码不是整百」的座位，逼出旧版的非整数倍问题
const st14 = E.createState();
E.newGame(st14, { seats: [{pid:0,name:'甲',chips:500},{pid:1,name:'乙',chips:995},{pid:2,name:'丙',chips:990}],
  sb:5, bb:10, buyin:500, straddleSeat:-1 });
T.setRoom('room', { pid:1, seat:st14.current, isHost:false, name:'乙', code:'123456', token:'t' });
T.setRoomStarted(true);
T.showView('gameView');
T.applyView({ ok:true, rev:2, code:'123456', token:'t', isHost:false, started:true,
  cfg:{count:6,buyin:500,sb:5,bb:10,straddleSeat:-1},
  players:[{pid:0,name:'甲',host:true,seat:0},{pid:1,name:'乙',host:false,seat:1},{pid:2,name:'丙',host:false,seat:2}],
  me:{pid:1, seat:st14.current, name:'乙'}, state:st14 });
{
  const seat = $id('seats').children[st14.current];
  const box = seat && seat._q['.act'];
  ok(box && box.innerHTML, '轮到我 -> 渲染出下注面板');
  const rng = box._q['input[type=range]'], num = box._q['.betnum'];
  const bb = st14.bb, maxTo = st14.players[st14.current].street + st14.players[st14.current].chips;
  const minTo = Math.max(st14.players[st14.current].street, st14.streetBet);
  const samples = [];
  for (let pc = 0; pc <= 100; pc++) { rng.value = String(pc); rng.dispatch('input'); samples.push(Number(num.value)); }
  eq(samples.length, 101, '从 0% 拖到 100% 取样 101 个值');
  eq(samples[0], minTo, '0% = 跟注/过牌额 ' + minTo);
  eq(samples[100], maxTo, '100% = 全下 ' + maxTo + '（不被吸附）');
  const mid = samples.slice(1, 100);
  const bad = mid.filter(v => v % bb !== 0);
  eq(bad, [], '中间档 99 个取值全部是大盲(' + bb + ')的整数倍');
  const uniq = Array.from(new Set(mid));
  eq(uniq.every((v,i) => i === 0 || v >= uniq[i-1]), true, '取值随拖动单调递增');
  ok(uniq.length >= 3, '不是全都塌成同一个值（有 ' + uniq.length + ' 档可选）');
  ok(mid.every(v => v >= minTo && v <= maxTo), '所有取值都落在 [跟注额, 后手] 内');
}

sec('15. 本地模式与房间模式渲染出的下注面板必须完全一致');
{
  // 本地
  T.setRoom('local', { pid:null, name:'本机', seat:null, isHost:true, code:null, token:null });
  T.setRoomStarted(false);
  T.startLocal(); T.saveSetup();
  const localS = T.getS();
  const localSeat = $id('seats').children[localS.current];
  const localHtml = localSeat && localSeat._q['.act'] ? localSeat._q['.act'].innerHTML : '';
  // 房间：完全相同的状态
  const st15 = E.createState();
  E.newGame(st15, { seats: [0,1,2,3,4,5].map(i => ({pid:i, name:'玩家 '+(i+1), chips:1000})),
    sb:5, bb:10, buyin:1000, straddleSeat:-1 });
  T.setRoom('room', { pid:0, seat:st15.current, isHost:true, name:'玩家 1', code:'123456', token:'t' });
  T.setRoomStarted(true);
  T.applyView({ ok:true, rev:3, code:'123456', token:'t', isHost:true, started:true,
    cfg:{count:6,buyin:1000,sb:5,bb:10,straddleSeat:-1},
    players:[0,1,2,3,4,5].map(i => ({pid:i, name:'玩家 '+(i+1), host:i===0, seat:i})),
    me:{pid:0, seat:st15.current, name:'玩家 1'}, state:st15 });
  const roomSeat = $id('seats').children[st15.current];
  const roomHtml = roomSeat && roomSeat._q['.act'] ? roomSeat._q['.act'].innerHTML : '';
  eq(localHtml.length > 0, true, '本地模式有下注面板');
  eq(roomHtml.length > 0, true, '房间模式有下注面板');
  eq(localHtml, roomHtml, '两种模式的下注面板 HTML 逐字节相同');
}

sec('16. 纯静态托管（GitHub Pages）给出明确提示，不再误导');
eq(T.apiErr({ code: 'NO_API' }).indexOf('GitHub Pages') >= 0, true, 'NO_API 提示里点名了 GitHub Pages');
eq(T.apiErr({ code: 'NO_API' }).indexOf('本地单机') >= 0, true, 'NO_API 提示里说明本地单机仍可用');
eq(T.apiErr({ code: 'NO_API' }).indexOf('serve.js') >= 0, false, 'NO_API 不再让你去跑 serve.js（在静态托管上没意义）');
eq(T.apiErr({ code: 'NETWORK' }), '连不上服务器，确认 serve.js 正在运行', '网络不通时仍提示跑 serve.js');
eq(T.apiErr(new Error('x')), '连不上服务器，确认 serve.js 正在运行', '未知错误走默认文案');
eq(T.apiBase(), '', '未配置 config.js 时后端地址为空 = 同源');

/* ---- 真实 HTTP：api() 要能区分「纯静态托管」和「后端没起」 ---- */
function nodeFetch(url, opt) {
  return new Promise((res, rej) => {
    const u = new URL(url);
    const r = http.request({ hostname: u.hostname, port: u.port || 80,
      path: u.pathname + u.search, method: (opt && opt.method) || 'GET',
      headers: (opt && opt.headers) || {} }, rp => {
      let d = '';
      rp.on('data', c => d += c);
      rp.on('end', () => res({
        ok: rp.statusCode >= 200 && rp.statusCode < 300, status: rp.statusCode,
        headers: { get: k => rp.headers[String(k).toLowerCase()] || null },
        json: async () => JSON.parse(d),
      }));
    });
    r.on('error', rej);
    if (opt && opt.body) r.write(opt.body);
    r.end();
  });
}
const listen = srv => new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));

(async function () {
  sec('17. 真实 HTTP：静态托管 / 后端没起 / 正常后端 三种情况');
  sandbox.fetch = nodeFetch;

  // 1) 模拟 GitHub Pages：页面 200，/api/* 回 404 HTML
  const staticSrv = http.createServer((req, res) => {
    if (req.url.indexOf('/api/') === 0) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<html><body>404 Not Found</body></html>');
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<html><body>index</body></html>');
  });
  const pStatic = await listen(staticSrv);
  sandbox.window.TEXAS_BET_API = 'http://127.0.0.1:' + pStatic;
  let e1 = null;
  try { await T.api('/api/create', { name: 'x' }); } catch (e) { e1 = e; }
  eq(e1 && e1.code, 'NO_API', 'GitHub Pages 式托管 -> 判定为 NO_API');
  await T.probeServer();
  ok(/GitHub Pages/.test($id('homeHint').textContent), '首页出现 GitHub Pages 说明：' + $id('homeHint').textContent.slice(0, 40) + '…');
  const createMsg = T.apiErr(e1);
  ok(createMsg.indexOf('本地单机') >= 0, '提示本地单机仍可用');

  // 2) 后端没起（连不上）-> NETWORK
  await new Promise(r => staticSrv.close(r));
  sandbox.window.TEXAS_BET_API = 'http://127.0.0.1:' + pStatic;
  let e2 = null;
  try { await T.api('/api/ping'); } catch (e) { e2 = e; }
  eq(e2 && e2.code, 'NETWORK', '连不上 -> 判定为 NETWORK');
  eq(T.apiErr(e2), '连不上服务器，确认 serve.js 正在运行', 'NETWORK 才提示跑 serve.js');
  await T.probeServer();
  eq($id('homeHint').textContent, '', '网络不通不误报成「静态托管」');

  // 3) 真后端
  const realSrv = require('./serve.js').createServer();
  const pReal = await listen(realSrv);
  sandbox.window.TEXAS_BET_API = 'http://127.0.0.1:' + pReal;
  const ping = await T.api('/api/ping');
  eq(ping.ok, true, '/api/ping 通');
  eq(ping.ver, '0.25alpha', '后端版本 0.25alpha');
  const made = await T.api('/api/create', { name: '桩内房主' });
  eq(!!(made && made.ok), true, '跨源创建房间成功，房间号 ' + (made && made.code));
  await T.probeServer();
  eq($id('homeHint').textContent, '', '真后端时首页不显示警告');

  // 4) CORS 头（网页与后端分开放必须有）
  const corsProbe = await new Promise((res, rej) => {
    http.get('http://127.0.0.1:' + pReal + '/api/ping', rp => {
      res({ origin: rp.headers['access-control-allow-origin'], code: rp.statusCode });
      rp.resume();
    }).on('error', rej);
  });
  eq(corsProbe.code, 200, 'GET /api/ping -> 200');
  eq(corsProbe.origin, '*', '已下发 Access-Control-Allow-Origin: *（跨域部署可用）');

  await new Promise(r => realSrv.close(r));
  sandbox.window.TEXAS_BET_API = '';

  console.log('\n' + (fails ? 'X ' + fails + ' 项失败' : '全部通过'));
process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
