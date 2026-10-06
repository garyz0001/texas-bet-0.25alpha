'use strict';
/* =========================================================
   德州扑克 · 虚拟下注器 —— 界面层（0.2alpha）
   规则与算账全部交给 engine.js（权威引擎），这里只负责画界面。
   两种模式：
     local = 单机，引擎在浏览器里跑
     room  = 多人房间，状态由 serve.js 下发，服务端是唯一权威
   下注语义：所有金额都是「本轮下注总额 (raise-to)」
   ========================================================= */

const E = window.PokerEngine;
const $ = id => document.getElementById(id);
const fmt = v => Math.round(v).toLocaleString('zh-CN');

let S = E.createState();          // 当前牌局状态（local 本地对象 / room 服务端快照）
let KIND = 'local';               // 'local' | 'room'
let ME = { pid: null, name: '', seat: null, isHost: true, code: null, token: null };
let ROOMCFG = { count: 6, buyin: 1000, sb: 5, bb: 10, straddleSeat: -1 };
let MEMBERS = [];                 // 房间成员（大厅用）
let ROOMSTARTED = false;
let SD_OPEN = false;              // 摊牌弹窗是否打开
let pollTimer = null, lastOk = 0, lastRev = -1;

const SS_KEY = 'poker.room';
const inRoom = () => KIND === 'room';
const canControl = () => !inRoom() || ME.isHost;
const mySeat = () => (inRoom() ? ME.seat : null);
function canActNow(seat) {
  if (S.phase !== 'playing' || S.current !== seat) return false;
  if (inRoom() && ME.seat !== seat) return false;
  return true;
}

/* ---------- 提示 ---------- */
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._tm);
  t._tm = setTimeout(() => t.classList.remove('show'), 2400);
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function renderLogOnly() {
  const el = $('log');
  if (!S || !S.log) { el.innerHTML = ''; return; }
  el.innerHTML = S.log.slice(-80).map(l => '<div class="' + l.cls + '">' + esc(l.msg) + '</div>').join('');
  el.scrollTop = el.scrollHeight;
}

/* ---------- 视图切换 ---------- */
function showView(id) {
  ['homeView', 'confirmView', 'lobbyView', 'gameView'].forEach(v =>
    $(v).classList.toggle('hidden', v !== id));
}
function homeError(msg) { $('homeErr').textContent = msg || ''; }
function homeHint(msg) { const el = $('homeHint'); if (el) el.textContent = msg || ''; }

/* ---------- 服务端通信 ---------- */
// 后端地址：留空 = 同源（本机 serve.js / 局域网 / 与网页同一台主机）。
// 纯静态托管（GitHub Pages 等）请在 config.js 里填一个能跑 Node 的后端地址。
// 后端地址允许运行时改（也方便测试切换静态托管 / 真后端两种场景）
function apiBase() { return (typeof window !== 'undefined' && window.TEXAS_BET_API) || ''; }

function apiErr(e) {
  if (e && e.code === 'NO_API') {
    return '这里没有房间后端（当前是纯静态托管，如 GitHub Pages）→ 房间功能不可用，' +
      '「本地单机」可以正常玩。开房间的部署方法见 版本说明.txt';
  }
  if (e && e.code === 'NETWORK') return '连不上服务器，确认 serve.js 正在运行';
  return '连不上服务器，确认 serve.js 正在运行';
}

async function api(path, body) {
  const opt = { method: body ? 'POST' : 'GET', headers: {} };
  if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  let r;
  try { r = await fetch(apiBase() + path, opt); }
  catch (e) { const x = new Error('NETWORK'); x.code = 'NETWORK'; throw x; }
  const ct = r.headers.get('content-type') || '';
  if (ct.indexOf('application/json') < 0) {      // 静态托管会回 HTML / 404 页
    const x = new Error('NO_API'); x.code = 'NO_API'; x.status = r.status; throw x;
  }
  return r.json();
}
/** 首页探测后端：纯静态托管时在首页给出明确说明 */
async function probeServer() {
  try {
    const v = await api('/api/ping');
    homeHint(v && v.ok ? '' : '');      // 通了就不提示
    return !!(v && v.ok);
  } catch (e) {
    // 只有「确认是静态托管」才给 GitHub Pages 提示，网络不通不要误报
    homeHint(e && e.code === 'NO_API' ? apiErr(e) : '');
    return false;
  }
}
function stateUrl() {
  return '/api/state?code=' + encodeURIComponent(ME.code) +
    '&token=' + encodeURIComponent(ME.token) + '&rev=' + lastRev;
}
function saveSession() {
  try { localStorage.setItem(SS_KEY, JSON.stringify({ code: ME.code, token: ME.token })); } catch (e) {}
}
function clearSession() { try { localStorage.removeItem(SS_KEY); } catch (e) {} }

/** 把服务端返回的视图套用到界面 */
function applyView(v, opts) {
  opts = opts || {};
  const fatal = opts.fatal || /不存在|失效|过期/.test(v.msg || '');
  if (!v.ok) { if (fatal) { clearSession(); backHome(v.msg || '房间已失效'); } else toast(v.msg || '操作失败'); return false; }
  if (v.same) return true;
  ME.pid = v.me.pid; ME.seat = v.me.seat; ME.isHost = v.isHost; ME.name = v.me.name;
  ME.code = v.code; ME.token = v.token || ME.token;
  MEMBERS = v.players || [];
  ROOMCFG = v.cfg || ROOMCFG;
  ROOMSTARTED = !!v.started;
  lastRev = v.rev;
  lastOk = Date.now();

  S = v.state;                                  // 未开局时为 null

  if (!ROOMSTARTED) { showView('lobbyView'); renderLobby(); closeShowdown(); return true; }
  if (S) {
    showView('gameView');
    // 先把摊牌弹窗开关落定，再渲染底部栏 —— 否则「下一手」按钮会一直算成隐藏
    const wantSd = S.phase === 'showdown' && S.pots && S.pots.length > 0;
    if (wantSd) openShowdown(); else closeShowdown();
    renderAll();
  }
  return true;
}

async function pollOnce(fatal) {
  if (!inRoom() || !ME.token) return;
  let v;
  try { v = await api(stateUrl()); }
  catch (e) { updateConn(false); return; }
  updateConn(true);
  applyView(v, { fatal: fatal });
}
function updateConn(ok) {
  if (ok) lastOk = Date.now();
  const chip = $('connChip');
  if (!chip) return;
  chip.hidden = !inRoom();
  const live = Date.now() - lastOk < 4000;
  $('connVal').textContent = live ? '在线' : '离线';
  $('connVal').style.color = live ? 'var(--green)' : 'var(--red)';
}
function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => {
    pollOnce(false);
    updateConn(false);
  }, 800);
}
function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

async function postAction(payload, fatal) {
  let v;
  try {
    v = await api('/api/action?code=' + encodeURIComponent(ME.code) +
      '&token=' + encodeURIComponent(ME.token), payload);
  } catch (e) { toast('网络错误，请重试'); return false; }
  if (!v.ok) {
    if (fatal && /不存在|失效/.test(v.msg || '')) { clearSession(); backHome(v.msg); }
    else toast(v.msg || '操作失败');
    return false;
  }
  if (v.gone) { clearSession(); backHome(''); return false; }
  applyView(v);
  return true;
}

/* ---------- 首页 ---------- */
function backHome(msg) {
  stopPolling();
  KIND = 'local'; S = E.createState();
  ME = { pid: null, name: '', seat: null, isHost: true, code: null, token: null };
  MEMBERS = []; ROOMSTARTED = false; SD_OPEN = false; lastRev = -1;
  closeShowdown();
  showView('homeView');
  homeError(msg);
  ['paneCreate', 'paneJoin'].forEach(id => $(id).classList.add('hidden'));
  $('btnBackRoom').classList.add('hidden');
}
/** 离开当前牌局回到首页。本地模式清空；房间模式只回首页、保留会话，可再回去。 */
function goHome() {
  if (!inRoom()) { backHome(''); return; }
  stopPolling();
  showView('homeView');
  homeError('');
  ['paneCreate', 'paneJoin'].forEach(id => $(id).classList.add('hidden'));
  const has = !!(ME.code && ME.token);
  $('btnBackRoom').classList.toggle('hidden', !has);
  $('backRoomNo').textContent = has ? ME.code : '';
}
/** 从首页回到原来的房间 */
async function backToRoom() {
  const ok = await restoreSession();
  if (!ok) { $('btnBackRoom').classList.add('hidden'); homeError('房间已失效，请重新加入'); }
}
/** 换房间 / 开本地局之前，先把旧房间退掉（未开局才能退），并清掉本地会话 */
async function dropOldRoom() {
  if (ME && ME.code && ME.token && !ROOMSTARTED) {
    try {
      await api('/api/action?code=' + encodeURIComponent(ME.code) +
        '&token=' + encodeURIComponent(ME.token), { action: 'leave' });
    } catch (e) {}
  }
  stopPolling();
  clearSession();
}

function openPane(which) {
  homeError('');
  $('paneCreate').classList.toggle('hidden', which !== 'create');
  $('paneJoin').classList.toggle('hidden', which !== 'join');
  if (which) $(which === 'create' ? 'inCreateName' : 'inJoinCode').focus();
}

function startLocal() {
  dropOldRoom();          // 后台退掉旧房间，不阻塞开桌
  KIND = 'local';
  ME = { pid: null, name: '本机', seat: null, isHost: true, code: null, token: null };
  S = E.createState();
  ROOMSTARTED = false;
  showView('gameView');
  renderAll();
  openSetup();
}

async function doCreate() {
  const name = $('inCreateName').value.trim();
  if (!name) return homeError('先给自己起个临时ID');
  await dropOldRoom();
  let v;
  try { v = await api('/api/create', { name: name }); }
  catch (e) { return homeError(apiErr(e)); }
  if (!v.ok) return homeError(v.msg || '创建失败');
  KIND = 'room';
  ME = { pid: v.me.pid, name: v.me.name, seat: v.me.seat, isHost: v.isHost, code: v.code, token: v.token };
  MEMBERS = v.players; ROOMCFG = v.cfg; ROOMSTARTED = false; lastRev = v.rev;
  saveSession();
  $('bigCode').textContent = v.code;
  $('myNameView').textContent = v.me.name;
  homeError('');
  showView('confirmView');
}

async function doJoin() {
  const code = $('inJoinCode').value.trim();
  const name = $('inJoinName').value.trim();
  if (!/^\d{6}$/.test(code)) return homeError('房间号是 6 位数字');
  if (!name) return homeError('先给自己起个临时ID');
  await dropOldRoom();
  let v;
  try { v = await api('/api/join', { code: code, name: name }); }
  catch (e) { return homeError(apiErr(e)); }
  if (!v.ok) return homeError(v.msg || '加入失败');
  KIND = 'room';
  ME = { pid: v.me.pid, name: v.me.name, seat: v.me.seat, isHost: v.isHost, code: v.code, token: v.token };
  MEMBERS = v.players; ROOMCFG = v.cfg; ROOMSTARTED = false; lastRev = v.rev;
  saveSession();
  homeError('');
  showView('lobbyView');
  renderLobby();
  startPolling();
}

function enterRoom() { showView('lobbyView'); renderLobby(); startPolling(); }

async function restoreSession() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(SS_KEY) || 'null'); } catch (e) {}
  if (!raw || !raw.code || !raw.token) return false;
  KIND = 'room'; ME.code = raw.code; ME.token = raw.token;
  let v;
  try { v = await api('/api/state?code=' + encodeURIComponent(raw.code) +
    '&token=' + encodeURIComponent(raw.token) + '&rev=-1'); }
  catch (e) { return false; }
  if (!v.ok) { clearSession(); return false; }
  applyView(v, { fatal: false });
  startPolling();
  return true;
}

/* ---------- 大厅 ---------- */
function renderLobby() {
  $('lobbyCode').textContent = ME.code;
  $('lobbyMyName').textContent = ME.name;
  const full = MEMBERS.length >= ROOMCFG.count;
  $('lobbyList').innerHTML = MEMBERS.map(m =>
    '<div class="mrow"><span class="mname">' + esc(m.name) + '</span>' +
    (m.host ? '<span class="mtag">房主</span>' : '') +
    (m.pid === ME.pid ? '<span class="mtag me">我</span>' : '') + '</div>').join('');
  $('lobbyHint').textContent = MEMBERS.length + ' / ' + ROOMCFG.count + ' 人' +
    (full ? '（已满）' : ' · 再等 ' + (ROOMCFG.count - MEMBERS.length) + ' 人');
  $('btnLobbySetup').classList.toggle('hidden', !canControl());
  $('btnLobbyStart').classList.toggle('hidden', !canControl());
}

/* ---------- 渲染 ---------- */
function renderAll() { renderTop(); renderStats(); renderSeats(); renderFooter(); renderLogOnly(); }

function renderTop() {
  const host = canControl();
  $('btnUndo').classList.toggle('hidden', !host);
  $('btnSetup').classList.toggle('hidden', !host);
  $('btnForceFold').classList.toggle('hidden', !(inRoom() && host && S && S.phase === 'playing'));
  $('roomChip').hidden = !inRoom();
  if (inRoom()) $('roomChipVal').textContent = ME.code;
  $('connChip').hidden = !inRoom();
}

function renderStats() {
  if (!S || !S.players.length) {
    ['stPot', 'stBet'].forEach(id => $(id).textContent = '0');
    ['stBlinds', 'stHand', 'stStreet'].forEach(id => $(id).textContent = '—');
    $('potBig').textContent = '0'; $('betLine').textContent = '等待开局';
    return;
  }
  $('stPot').textContent = fmt(E.boardPot(S));
  $('stBet').textContent = fmt(S.streetBet);
  $('stBlinds').textContent = S.sb + '/' + S.bb;
  $('stHand').textContent = S.handNo || '—';
  $('stStreet').textContent = S.phase === 'showdown' ? '摊牌'
    : (S.phase === 'over' ? '结束' : (E.STREET_NAME[S.street] || '—'));
  $('potBig').textContent = fmt(E.boardPot(S));
  const bits = [];
  if (S.streetBet > 0) bits.push('本轮最高 ' + fmt(S.streetBet));
  bits.push('未弃牌 ' + S.players.filter(p => !p.folded).length + ' 人');
  if (inRoom()) bits.push('房间 ' + ME.code);
  $('betLine').textContent = bits.join(' · ');
}

function statusCls(p) {
  const a = p.lastAct || '';
  if (/弃牌|全下/.test(a)) return 'f';
  if (/赢下|平分|收回/.test(a)) return 'w';
  if (/过牌|跟注|加注/.test(a)) return 'a';
  return '';
}

function renderSeats() {
  const wrap = $('seats');
  wrap.innerHTML = '';
  if (!S || !S.players.length) {
    wrap.innerHTML = '<div class="empty">点下方「开始游戏」设置牌桌</div>';
    return;
  }
  const posOf = E.badges(S);
  S.players.forEach(p => {
    const isTurn = S.current === p.id && S.phase === 'playing';
    const mine = inRoom() && ME.seat === p.id;
    const seat = document.createElement('div');
    seat.className = ['seat', isTurn ? 'active' : '', p.folded ? 'folded' : '',
      /赢下|平分/.test(p.lastAct) ? 'winner' : '', mine ? 'mine' : ''].join(' ');
    seat.innerHTML =
      '<div class="top"><span class="badge">' + posOf[p.id] + '</span>' +
      '<span class="pname">' + esc(p.name) + '</span>' +
      (mine ? '<span class="tag mine">我</span>' : '') +
      (p.allIn ? '<span class="tag">ALL IN</span>' : '') +
      (p.street ? '<span class="tag">本轮 ' + fmt(p.street) + '</span>' : '') + '</div>' +
      '<div class="money">' + fmt(p.chips) + '<small> 筹码</small></div>' +
      '<div class="status ' + statusCls(p) + '">' + esc(p.lastAct || '等待') + '</div>' +
      '<div class="act"></div>';
    if (isTurn && canActNow(p.id)) renderSeatActions(seat.querySelector('.act'), p);
    wrap.appendChild(seat);
  });
}

/* ---------- 座位内下注 UI ----------
   快捷按钮：显示算好的金额，点击只「填入滑条」，不立即下注，可继续微调再确认 */
function renderSeatActions(box, p) {
  const o = E.betOptions(S, p.id);
  if (!o) return;
  const toCall = o.toCall, minTo = o.minTo, maxTo = o.maxTo;
  const chips = Math.max(1, p.chips);

  const pct = v => Math.max(0, Math.min(100, Math.round((v - p.street) / chips * 100)));
  const b = (label, val, cls) =>
    '<button class="qbtn ' + (cls || '') + '" data-v="' + val + '">' + label + '</button>';

  let html = '<div class="quick">';
  o.options.forEach(op => { html += b(op.label + ' ' + fmt(op.value), op.value, op.key === 'call' ? 'call' : ''); });
  html += '</div>';

  html += '<div class="betrow"><div class="sliderwrap">' +
    '<input type="range" min="0" max="100" value="' + pct(minTo) + '">' +
    '<div class="sliderfoot"><span>' + fmt(minTo) + '</span>' +
    '<span class="mid">跟注 ' + fmt(toCall) + '</span><span>' + fmt(maxTo) + '</span></div>' +
    '</div><div class="amin"><input type="number" class="betnum" value="' + minTo + '"></div></div>' +
    '<div class="actions">' +
    '<button class="btn fold" data-a="fold">弃牌</button>' +
    '<button class="btn ok" data-a="ok">' + (toCall > 0 ? '跟注 ' + fmt(toCall) : '过牌') + '</button>' +
    '</div>';
  box.innerHTML = html;

  const rng = box.querySelector('input[type=range]');
  const num = box.querySelector('.betnum');
  const ok = box.querySelector('[data-a=ok]');
  const clamp = v => Math.max(minTo, Math.min(Math.round(Number(v)) || 0, maxTo));
  const bb = Math.max(1, Math.round(S.bb || 1));
  /** 滑条取值吸附：中间档一律是大盲整数倍；两端保留「跟注额」「全下额」原值 */
  const snap = raw => {
    const v = Math.round(Number(raw));
    if (!isFinite(v)) return minTo;
    if (v >= maxTo) return maxTo;                 // 拖到 100% = 全下，用真实后手
    if (v <= minTo) return minTo;                 // 拖到 0% = 跟注/过牌，用真实跟注额
    return clamp(Math.round(v / bb) * bb);        // 其余吸附到最近的大盲倍数
  };
  const sync = keepSlider => {
    const to = clamp(num.value);
    num.value = to;
    if (!keepSlider) rng.value = pct(to);         // 拖动中不回写滑条，避免指针抖动
    ok.textContent = to <= toCall ? (toCall > 0 ? '跟注 ' + fmt(toCall) : '过牌') : '确定 ' + fmt(to);
  };
  rng.addEventListener('input', () => {
    num.value = snap(p.street + Number(rng.value) / 100 * chips);
    sync(true);
  });
  num.addEventListener('input', () => sync(false));   // 手输保留精确值，方便微调
  num.addEventListener('blur', () => sync(false));

  Array.prototype.forEach.call(box.querySelectorAll('[data-v]'), x =>
    x.addEventListener('click', () => {
      num.value = clamp(Number(x.dataset.v));
      sync();
      box.scrollIntoView({ block: 'nearest' });
    }));

  box.querySelector('[data-a=fold]').addEventListener('click', () => doFold());
  ok.addEventListener('click', () => doCommit(num.value));
}

/* ---------- 动作 ---------- */
function doFold() {
  if (inRoom()) { postAction({ action: 'fold' }); return; }
  if (E.doFold(S, S.current)) afterLocal();
}
function doCommit(amount) {
  if (inRoom()) { postAction({ action: 'commit', amount: Number(amount) }); return; }
  if (E.doCommit(S, S.current, amount)) afterLocal();
}
function afterLocal() {
  renderAll();
  if (S.phase === 'showdown' && S.pots && S.pots.length) openShowdown();
  else closeShowdown();
}

/* ---------- 底部栏 ---------- */
function renderFooter() {
  const turn = $('abTurn'), hint = $('abHint');
  if (!S) { turn.textContent = '等待开局'; hint.textContent = '只记录筹码 · 现实发牌'; return; }
  const ctrl = canControl();
  const showNext = S.phase === 'showdown' && !SD_OPEN && ctrl;
  $('btnStart').classList.toggle('hidden', !(KIND === 'local' && S.phase === 'idle'));
  $('btnNext').classList.toggle('hidden', !showNext);
  const cur = S.current !== null && S.players[S.current] ? S.players[S.current] : null;
  if (S.phase === 'playing' && cur) {
    const toCall = Math.max(0, S.streetBet - cur.street);
    const isMine = canActNow(cur.id);
    turn.textContent = isMine ? '轮到你行动' : ('轮到 ' + cur.name);
    if (isMine) hint.textContent = toCall > 0 ? ('需跟注 ' + fmt(toCall)) : '无需跟注 · 可过牌或下注';
    else if (inRoom() && ME.seat < 0) hint.textContent = '你将在下一手上桌';
    else hint.textContent = '等对方操作…';
  } else if (S.phase === 'showdown') {
    turn.textContent = ctrl ? '摊牌中 — 请确认赢家' : '摊牌中 — 等待房主确认';
    hint.textContent = ctrl ? '选 1 人独赢 · 选多人平分' : '房主正在决定胜负';
  } else if (S.phase === 'over') {
    turn.textContent = '游戏结束';
    hint.textContent = ctrl ? '点「牌桌设置」重开' : '等待房主重开牌桌';
  } else {
    turn.textContent = '等待开局';
    hint.textContent = '只记录筹码 · 现实发牌';
  }
}

/* ---------- 摊牌：手动确认胜负 ---------- */
function openShowdown() {
  if (!S || !S.pots || !S.pots.length) return;
  const ctrl = canControl();
  const box = $('showdownPlayers');
  box.innerHTML = '';
  S.pots.forEach((pot, pi) => {
    const only = pot.eligible.length === 1;
    if (ctrl && only && pot.winners.length === 0) pot.winners = [pot.eligible[0]];
    const card = document.createElement('div');
    card.className = 'potcard';
    const who = only ? S.players[pot.eligible[0]].name : (pot.eligible.length + ' 人可赢');
    card.innerHTML = '<div class="pchead"><span class="pcname">' +
      (pi === 0 ? '主池' : '边池 ' + pi) + '</span><b>' + fmt(pot.amount) +
      '</b><span class="pcdim">' + esc(who) + '</span></div>';
    const row = document.createElement('div');
    row.className = 'sd-players';
    pot.eligible.forEach(id => {
      const p = S.players[id];
      const d = document.createElement('div');
      d.className = 'sd-p' + (pot.winners.indexOf(id) >= 0 ? ' sel' : '');
      d.innerHTML = '<span>' + esc(p.name) + '</span><span class="sd-chip">' + fmt(p.chips) + '</span>';
      if (ctrl) d.addEventListener('click', () => {
        const i = pot.winners.indexOf(id);
        if (i >= 0) pot.winners.splice(i, 1); else pot.winners.push(id);
        openShowdown();
      });
      row.appendChild(d);
    });
    card.appendChild(row);
    box.appendChild(card);
  });
  const folded = S.players.filter(p => p.folded).map(p => p.name);
  $('poolInfo').innerHTML = '合计 <b>' + fmt(S.pot) + '</b> · 每个池选 1 人独赢，选多人则平分' +
    (folded.length ? '<br><span class="dim">已弃牌：' + esc(folded.join('、')) + '</span>' : '');
  $('sdSub').textContent = ctrl
    ? '点选赢家；多人同时选中 = 平分底池'
    : '房主正在决定胜负，这里只能看';
  $('sdActionsHost').classList.toggle('hidden', !ctrl);
  $('mShowdown').classList.remove('hidden');
  SD_OPEN = true;
}
function closeShowdown() {
  const m = $('mShowdown');
  if (m && !m.classList.contains('hidden')) m.classList.add('hidden');
  SD_OPEN = false;
}
function confirmWin() {
  const winners = S.pots.map(p => p.winners);
  if (inRoom()) { postAction({ action: 'confirmWin', winners: winners }); return; }
  const r = E.confirmWin(S, winners);
  if (!r.ok) return toast(r.msg);
  closeShowdown();
  renderAll();
  toast('已结算');
}

/* ---------- 开桌 ---------- */
function openSetup() {
  if (!canControl()) return toast('只有房主可以改牌桌设置');
  const src = inRoom()
    ? { count: ROOMCFG.count, buyin: ROOMCFG.buyin, sb: ROOMCFG.sb, bb: ROOMCFG.bb,
        straddle: ROOMCFG.straddleSeat, names: MEMBERS.map(m => m.name) }
    : { count: S.players.length || 6,
        buyin: S.players.length ? Math.max.apply(null, S.players.map(p => p.chips)) : 1000,
        sb: S.sb, bb: S.bb, straddle: S.straddleSeat,
        names: S.players.map(p => p.name) };
  $('setPlayers').value = src.count;
  $('setBuyin').value = src.buyin;
  $('setSb').value = src.sb;
  $('setBb').value = src.bb;
  $('lblPlayers').textContent = inRoom()
    ? ('人数上限（已加入 ' + MEMBERS.length + ' 人）') : '人数（2 – 10）';
  $('fieldNames').querySelector('span').innerHTML = inRoom()
    ? '已加入的玩家 <em class="tip">（点「抓头」设定该座位每手额外 +1 强制大盲）</em>'
    : '玩家名单 <em class="tip">（点「抓头」设定该座位每手额外 +1 强制大盲）</em>';
  $('btnSaveSetup').textContent = (inRoom() && ROOMSTARTED) ? '保存并重开牌桌' : '保存设置';
  buildNames(src.count, src.names, src.straddle, inRoom());
  $('mSetup').classList.remove('hidden');
}

function buildNames(count, old, straddle, readonly) {
  const nl = $('nameList');
  nl.innerHTML = '';
  old = old || [];
  const sel = $('setStraddle');
  sel.value = straddle >= 0 ? String(straddle) : '';
  const paint = () => Array.prototype.forEach.call(nl.querySelectorAll('.nrow'), (r, i) =>
    r.classList.toggle('str', sel.value !== '' && Number(sel.value) === i));
  for (let i = 0; i < count; i++) {
    const joined = i < old.length;
    const w = document.createElement('div');
    w.className = 'nrow';
    w.innerHTML = '<input type="text" value="' + esc(old[i] || '') + '" placeholder="' +
      (readonly ? '等待加入' : '玩家 ' + (i + 1)) + '"' + (readonly ? ' disabled' : '') + '>' +
      '<button class="stbtn" type="button"' + (!readonly && !joined ? ' disabled' : '') + '>抓头</button>';
    w.querySelector('.stbtn').addEventListener('click', () => {
      sel.value = sel.value === String(i) ? '' : String(i);
      paint();
    });
    nl.appendChild(w);
  }
  paint();
}

function readSetup() {
  const count = Math.max(2, Math.min(10, Number($('setPlayers').value) || 6));
  const buyin = Math.max(1, Number($('setBuyin').value) || 1000);
  const sb = Math.max(1, Number($('setSb').value) || 5);
  const bb = Math.max(sb, Number($('setBb').value) || 10);
  const sv = $('setStraddle').value;
  const st = sv === '' ? -1 : Math.max(0, Math.min(count - 1, Number(sv)));
  return { count: count, buyin: buyin, sb: sb, bb: bb, straddleSeat: st };
}

async function saveSetup() {
  const cfg = readSetup();
  if (inRoom()) {
    if (ROOMSTARTED) { $('mSetup').classList.add('hidden'); await postAction({ action: 'start', cfg: cfg }); }
    else { await postAction({ action: 'setup', cfg: cfg }); $('mSetup').classList.add('hidden'); }
    return;
  }
  const names = Array.prototype.map.call($('nameList').querySelectorAll('input'), x => x.value);
  const seats = [];
  for (let i = 0; i < cfg.count; i++) seats.push({ pid: i, name: names[i], chips: cfg.buyin });
  S.players = []; S.log = []; S.history = []; S.pots = []; S.bench = [];
  E.newGame(S, { seats: seats, sb: cfg.sb, bb: cfg.bb, buyin: cfg.buyin, straddleSeat: cfg.straddleSeat });
  ROOMSTARTED = true;
  $('mSetup').classList.add('hidden');
  closeShowdown();
  renderAll();
  toast('牌桌已重开');
}

function nextHandClick() {
  if (inRoom()) { postAction({ action: 'next' }); return; }   // 关弹窗交给 applyView，失败时还能重试
  closeShowdown();
  E.nextHand(S);
  renderAll();
}
function undoClick() {
  if (inRoom()) { postAction({ action: 'undo' }); return; }
  if (E.undo(S)) { closeShowdown(); renderAll(); toast('已撤销'); }
  else toast('没有可撤销的操作');
}
function forceFoldClick() {
  if (!inRoom() || !canControl()) return;
  if (!confirm('把当前行动者强制弃牌？（用于对方掉线卡住）')) return;
  postAction({ action: 'forceFold' });
}
async function leaveRoom() {
  if (!inRoom()) return;
  await postAction({ action: 'leave' });
  clearSession();
  backHome('');
}

function copyCode() {
  const txt = ME.code || '';
  const done = () => toast('房间号已复制');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(txt).then(done, () => toast('复制失败，手动记下：' + txt));
  } else toast('房间号：' + txt);
}

/* ---------- 事件 ---------- */
$('btnLocal').addEventListener('click', startLocal);
$('btnCreateOpen').addEventListener('click', () => openPane('create'));
$('btnJoinOpen').addEventListener('click', () => openPane('join'));
$('btnCreateGo').addEventListener('click', doCreate);
$('btnJoinGo').addEventListener('click', doJoin);
$('inJoinName').addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(); });
$('inCreateName').addEventListener('keydown', e => { if (e.key === 'Enter') doCreate(); });
$('btnEnterRoom').addEventListener('click', enterRoom);
$('btnCopyCode').addEventListener('click', copyCode);
$('btnCopyCode2').addEventListener('click', copyCode);
$('btnLeave').addEventListener('click', leaveRoom);
$('btnLobbySetup').addEventListener('click', openSetup);
$('btnLobbyStart').addEventListener('click', () => postAction({ action: 'start', cfg: ROOMCFG }));
$('btnHome').addEventListener('click', goHome);
$('btnHomeLobby').addEventListener('click', goHome);
$('btnBackRoom').addEventListener('click', backToRoom);

$('btnSetup').addEventListener('click', openSetup);
$('btnCancelSetup').addEventListener('click', () => $('mSetup').classList.add('hidden'));
$('setPlayers').addEventListener('input', () => {
  const c = Math.max(2, Math.min(10, Number($('setPlayers').value) || 6));
  const cur = Array.prototype.map.call($('nameList').querySelectorAll('input'), x => x.value);
  buildNames(c, cur, $('setStraddle').value === '' ? -1 : Number($('setStraddle').value), inRoom());
});
$('btnSaveSetup').addEventListener('click', saveSetup);
$('btnStart').addEventListener('click', openSetup);
$('btnNext').addEventListener('click', nextHandClick);
$('btnUndo').addEventListener('click', undoClick);
$('btnForceFold').addEventListener('click', forceFoldClick);
$('btnConfirmWin').addEventListener('click', confirmWin);
$('btnSplit').addEventListener('click', confirmWin);

document.addEventListener('keydown', e => {
  if (e.target && e.target.tagName === 'INPUT') return;
  if (!SD_OPEN || !canControl() || !S) return;
  let pi = S.pots.findIndex(p => p.eligible.length > 1);
  if (pi < 0) pi = 0;
  const pot = S.pots[pi];
  if (!pot) return;
  const idx = Number(e.key) - 1;
  if (!(idx >= 0 && idx < pot.eligible.length)) return;
  const id = pot.eligible[idx];
  const i = pot.winners.indexOf(id);
  if (i >= 0) pot.winners.splice(i, 1); else pot.winners.push(id);
  openShowdown();
});

document.addEventListener('visibilitychange', () => { if (!document.hidden) pollOnce(false); });
window.addEventListener('focus', () => { if (inRoom()) pollOnce(false); });

/* ---------- 启动 ---------- */
(async function init() {
  showView('homeView');
  const restored = await restoreSession();
  if (!restored) showView('homeView');
  probeServer();          // 纯静态托管时在首页给出明确说明
})();
