'use strict';
/* =========================================================
   德州扑克虚拟下注器 · 本地服务器（0.2alpha）
   - 静态文件服务
   - 房间 API：创建 / 加入 / 轮询状态 / 行动
   所有规则仍然由 engine.js 判定，服务端是唯一权威。
   用法：双击 启动服务器.bat，或 node serve.js
   ========================================================= */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const E = require('./engine.js');

const PORT = Number(process.env.PORT) || 8080;
const DIR = __dirname;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/* ---------------- 房间 ---------------- */
const rooms = new Map();
const ROOM_TTL = 12 * 3600 * 1000;   // 12 小时无人活动则回收

function genCode() {
  for (let i = 0; i < 200; i++) {
    const c = String(Math.floor(100000 + Math.random() * 900000));
    if (!rooms.has(c)) return c;
  }
  return String(Date.now() % 1000000);
}
const genToken = () => crypto.randomBytes(16).toString('hex');
function cleanName(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, 12);
}
function clampInt(v, lo, hi, dflt) {
  const n = Number(v);
  if (!isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}
function touch(room) { room.touched = Date.now(); }
function bump(room) { room.rev++; touch(room); }

function defaultCfg() {
  return { count: 6, buyin: 1000, sb: 5, bb: 10, straddleSeat: -1 };
}
/** 返回 null 表示通过，否则返回错误文案 */
function applyCfg(room, raw) {
  if (!raw || typeof raw !== 'object') return null;
  const c = room.cfg;
  if (raw.count != null) c.count = clampInt(raw.count, 2, 10, c.count);
  if (raw.buyin != null) c.buyin = clampInt(raw.buyin, 1, 1000000, c.buyin);
  if (raw.sb != null) c.sb = clampInt(raw.sb, 1, 100000, c.sb);
  if (raw.bb != null) c.bb = clampInt(raw.bb, 1, 1000000, c.bb);
  if (c.bb < c.sb) c.bb = c.sb;
  if (raw.straddleSeat !== undefined) {
    const n = Number(raw.straddleSeat);
    c.straddleSeat = (!isFinite(n) || n < 0) ? -1 : Math.min(c.count - 1, Math.round(n));
  } else if (c.straddleSeat >= c.count) {
    c.straddleSeat = -1;
  }
  if (room.players.length > c.count) {
    return '人数上限不能小于已加入的 ' + room.players.length + ' 人';
  }
  return null;
}

function createRoom(name) {
  if (rooms.size > 300) return { err: '房间太多，请稍后再试' };
  const code = genCode();
  const pl = { pid: 0, name: name, token: genToken() };
  const room = {
    code: code, createdAt: Date.now(), touched: Date.now(), rev: 1,
    hostPid: 0, nextPid: 1, cfg: defaultCfg(),
    players: [pl], state: null, started: false,
  };
  rooms.set(code, room);
  return { room: room, player: pl };
}

function joinRoom(code, name) {
  const room = rooms.get(String(code == null ? '' : code).trim());
  if (!room) return { err: '房间号不存在' };
  if (room.players.some(p => p.name === name)) return { err: '该临时ID已被使用，换一个吧' };
  if (room.players.length >= room.cfg.count) return { err: '房间已满（' + room.cfg.count + ' 人）' };
  const pl = { pid: room.nextPid++, name: name, token: genToken() };
  room.players.push(pl);
  // 开局后才加入 → 候补席，下一手才上桌
  if (room.started && room.state) {
    room.state.bench.push({ pid: pl.pid, name: pl.name, chips: room.cfg.buyin });
  }
  bump(room);
  return { room: room, player: pl };
}

function publicState(S) {
  const o = {};
  for (const k in S) { if (k === 'history') continue; o[k] = S[k]; }
  if (o.log && o.log.length > 80) o.log = o.log.slice(-80);
  return o;
}
function seatOf(room, pid) {
  return room.state ? room.state.players.findIndex(p => p.pid === pid) : -1;
}
function view(room, pl) {
  const st = room.state;
  const seat = seatOf(room, pl.pid);
  const canAct = !!(st && st.phase === 'playing' && st.current === seat && seat >= 0);
  return {
    ok: true, rev: room.rev, token: pl.token, code: room.code,
    started: room.started, cfg: room.cfg,
    isHost: pl.pid === room.hostPid,
    players: room.players.map(p => ({
      pid: p.pid, name: p.name, host: p.pid === room.hostPid,
      seat: seatOf(room, p.pid),
    })),
    me: { pid: pl.pid, name: pl.name, seat: seat },
    state: st ? publicState(st) : null,
    canAct: canAct,
    options: canAct ? E.betOptions(st, seat) : null,
  };
}

/* ---------------- 行动 ---------------- */
const HOST_ONLY = { setup: 1, start: 1, next: 1, undo: 1, confirmWin: 1, forceFold: 1 };

function act(room, pl, body) {
  const a = body && body.action;
  const st = room.state;
  const isHost = pl.pid === room.hostPid;
  if (HOST_ONLY[a] && !isHost) return { ok: false, msg: '只有房主可以操作' };

  if (a === 'start') {
    if (body.cfg) { const err = applyCfg(room, body.cfg); if (err) return { ok: false, msg: err }; }
    if (room.players.length < 2) return { ok: false, msg: '至少需要 2 人才能开始' };
    const seats = room.players.map(p => ({ pid: p.pid, name: p.name, chips: room.cfg.buyin }));
    const ns = E.createState();
    E.newGame(ns, {
      seats: seats, sb: room.cfg.sb, bb: room.cfg.bb,
      buyin: room.cfg.buyin, straddleSeat: room.cfg.straddleSeat,
    });
    room.state = ns; room.started = true; bump(room);
    return { ok: true };
  }
  if (a === 'setup') {
    const err = applyCfg(room, body.cfg);
    if (err) return { ok: false, msg: err };
    bump(room);
    return { ok: true };
  }

  if (a === 'leave') {
    if (room.started) return { ok: false, msg: '牌局进行中，无法退出房间' };
    room.players = room.players.filter(p => p.pid !== pl.pid);
    if (!room.players.length) { rooms.delete(room.code); return { ok: true, gone: true }; }
    if (room.hostPid === pl.pid) room.hostPid = room.players[0].pid;
    bump(room);
    return { ok: true, gone: true };
  }

  if (!room.started || !st) return { ok: false, msg: '牌局还没开始' };

  if (a === 'next') { E.nextHand(st); bump(room); return { ok: true }; }
  if (a === 'undo') {
    if (!E.undo(st)) return { ok: false, msg: '没有可撤销的操作' };
    bump(room); return { ok: true };
  }
  if (a === 'confirmWin') {
    const r = E.confirmWin(st, Array.isArray(body.winners) ? body.winners : []);
    if (!r.ok) return { ok: false, msg: r.msg };
    bump(room); return { ok: true };
  }
  if (a === 'forceFold') {
    if (st.phase !== 'playing' || st.current == null) return { ok: false, msg: '当前不能弃牌' };
    if (!E.doFold(st, st.current)) return { ok: false, msg: '弃牌失败' };
    bump(room); return { ok: true };
  }
  if (a === 'fold' || a === 'commit') {
    if (st.phase !== 'playing') return { ok: false, msg: '当前不能行动' };
    const seat = seatOf(room, pl.pid);
    if (seat < 0) return { ok: false, msg: '你不在牌桌上' };
    if (st.current !== seat) return { ok: false, msg: '还没轮到你' };
    const ok = a === 'fold' ? E.doFold(st, seat) : E.doCommit(st, seat, body.amount);
    if (!ok) return { ok: false, msg: '操作失败，请重试' };
    bump(room); return { ok: true };
  }  return { ok: false, msg: '未知操作' };
}

/* ---------------- HTTP ---------------- */
function json(res, obj) {
  const b = Buffer.from(JSON.stringify(obj));
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': b.length, 'Cache-Control': 'no-store',
  });
  res.end(b);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => {
      data += c;
      if (data.length > 65536) { reject(new Error('too large')); req.destroy(); }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
function getRoomPl(url) {
  const code = (url.searchParams.get('code') || '').trim();
  const token = url.searchParams.get('token') || '';
  const room = rooms.get(code);
  if (!room) return { err: '房间号不存在或已过期' };
  const pl = room.players.find(p => p.token === token);
  if (!pl) return { err: '身份失效，请重新加入房间' };
  return { room: room, player: pl };
}

async function api(req, res, url) {
  const p = url.pathname;
  if (req.method === 'GET' && p === '/api/ping') {
    return json(res, { ok: true, app: 'texas-bet', ver: '0.25alpha' });
  }
  if (req.method === 'GET' && p === '/api/state') {
    const r = getRoomPl(url);
    if (r.err) return json(res, { ok: false, msg: r.err });
    touch(r.room);
    const want = Number(url.searchParams.get('rev'));
    if (isFinite(want) && want === r.room.rev) return json(res, { ok: true, same: true, rev: r.room.rev });
    return json(res, view(r.room, r.player));
  }
  if (req.method !== 'POST') return json(res, { ok: false, msg: '接口不存在' });

  let body;
  try { body = JSON.parse((await readBody(req)) || '{}'); }
  catch (e) { return json(res, { ok: false, msg: '请求格式错误' }); }

  if (p === '/api/create') {
    const name = cleanName(body.name);
    if (!name) return json(res, { ok: false, msg: '请输入临时ID' });
    const r = createRoom(name);
    if (r.err) return json(res, { ok: false, msg: r.err });
    return json(res, view(r.room, r.player));
  }
  if (p === '/api/join') {
    const name = cleanName(body.name);
    if (!name) return json(res, { ok: false, msg: '请输入临时ID' });
    const r = joinRoom(body.code, name);
    if (r.err) return json(res, { ok: false, msg: r.err });
    return json(res, view(r.room, r.player));
  }
  if (p === '/api/action') {
    const g = getRoomPl(url);
    if (g.err) return json(res, { ok: false, msg: g.err });
    const r = act(g.room, g.player, body);
    if (!r.ok) return json(res, r);
    if (r.gone) return json(res, r);
    return json(res, view(g.room, g.player));
  }
  return json(res, { ok: false, msg: '接口不存在' });
}

function serveStatic(req, res, url) {
  let name = decodeURIComponent(url.pathname);
  if (name === '/') name = '/index.html';
  const file = path.join(DIR, path.normalize(name).replace(/^(\.\.[\\/])+/, ''));
  if (!file.startsWith(DIR)) { res.writeHead(403); return res.end('403'); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('404 Not Found'); }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(buf);
  });
}

function cors(res) {
  // 网页和后端分开放（如 GitHub Pages + 独立 Node 主机）时需要跨域
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const server = http.createServer((req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  let url;
  try { url = new URL(req.url, 'http://localhost'); }
  catch (e) { res.writeHead(400); return res.end('400'); }
  if (url.pathname.indexOf('/api/') === 0) {
    api(req, res, url).catch(() => { try { json(res, { ok: false, msg: '服务器内部错误' }); } catch (e) {} });
    return;
  }
  serveStatic(req, res, url);
});

/* 回收长时间无人活动的房间 */
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.touched > ROOM_TTL) rooms.delete(code);
  }
}, 10 * 60 * 1000);
if (sweeper.unref) sweeper.unref();

function listen(port, host, cb) { return server.listen(port, host, cb); }

function banner() {
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list || []) if (n.family === 'IPv4' && !n.internal) ips.push(n.address);
  }
  console.log('');
  console.log('  德州扑克虚拟下注器 · 0.25alpha · 已启动');
  console.log('  房间 API：  /api/ping 可用于探测后端是否可用');
  console.log('  ─────────────────────────────────');
  console.log('  本机打开：  http://localhost:' + PORT);
  ips.forEach(ip => console.log('  手机打开：  http://' + ip + ':' + PORT));
  console.log('  ─────────────────────────────────');
  console.log('  保持这个窗口开着。按 Ctrl+C 停止。');
  console.log('');
}

if (require.main === module) {
  server.on('error', e => {
    if (e.code === 'EADDRINUSE') {
      console.error('  端口 ' + PORT + ' 已被占用，可能已经在运行了。');
      console.error('  直接用浏览器打开 http://localhost:' + PORT + ' 试试。');
    } else console.error('  启动失败：', e.message);
    process.exit(1);
  });
  listen(PORT, '0.0.0.0', banner);
}

module.exports = { createServer: () => server, rooms: rooms, _api: api, _act: act, _view: view };
