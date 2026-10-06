'use strict';
/* =========================================================
   房间逻辑核心 —— 平台无关，Node(serve.js) 和 Cloudflare(worker.mjs)
   共用同一份代码，规则唯一权威仍然是 engine.js。
   只依赖：一个 engine 对象 + 一个 Map(rooms)，不碰任何 Node 专有 API。
   ========================================================= */
const VER = '0.25alpha';
const ROOM_TTL = 12 * 3600 * 1000;   // 12 小时无人活动则回收
const MAX_ROOMS = 300;

module.exports = function createCore(E) {
  const rooms = new Map();

  function genCode() {
    for (let i = 0; i < 200; i++) {
      const c = String(Math.floor(100000 + Math.random() * 900000));
      if (!rooms.has(c)) return c;
    }
    return String(Date.now() % 1000000);
  }
  // 不用 require('crypto')：Cloudflare Workers 里没有它
  function genToken() {
    const arr = new Uint8Array(16);
    const g = globalThis.crypto;
    if (g && typeof g.getRandomValues === 'function') g.getRandomValues(arr);
    else for (let i = 0; i < 16; i++) arr[i] = Math.floor(Math.random() * 256);
    let s = '';
    for (let i = 0; i < 16; i++) s += arr[i].toString(16).padStart(2, '0');
    return s;
  }
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
    if (rooms.size > MAX_ROOMS) return { err: '房间太多，请稍后再试' };
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
      started: room.started, cfg: room.cfg, ver: VER,
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
      const done = a === 'fold' ? E.doFold(st, seat) : E.doCommit(st, seat, body.amount);
      if (!done) return { ok: false, msg: '操作失败，请重试' };
      bump(room); return { ok: true };
    }
    return { ok: false, msg: '未知操作' };
  }

  /* ---------------- 路由（平台无关） ---------------- */
  function who(searchParams) {
    const code = String(searchParams.get('code') || '').trim();
    const token = String(searchParams.get('token') || '');
    const room = rooms.get(code);
    if (!room) return { err: '房间号不存在或已过期' };
    const pl = room.players.find(p => p.token === token);
    if (!pl) return { err: '身份失效，请重新加入房间' };
    return { room: room, player: pl };
  }

  /**
   * @param method   'GET' | 'POST'
   * @param pathname '/api/...' 
   * @param searchParams URLSearchParams
   * @param body     已解析的 JSON 对象；POST 解析失败时传 null
   * @returns {{body:Object, changed:boolean}}
   */
  function route(method, pathname, searchParams, body) {
    if (method === 'GET' && pathname === '/api/ping') {
      return { body: { ok: true, app: 'texas-bet', ver: VER }, changed: false };
    }
    if (method === 'GET' && pathname === '/api/state') {
      const r = who(searchParams);
      if (r.err) return { body: { ok: false, msg: r.err }, changed: false };
      touch(r.room);
      const want = Number(searchParams.get('rev'));
      if (isFinite(want) && want === r.room.rev) {
        return { body: { ok: true, same: true, rev: r.room.rev }, changed: false };
      }
      return { body: view(r.room, r.player), changed: false };
    }
    if (method !== 'POST') return { body: { ok: false, msg: '接口不存在' }, changed: false };
    if (body == null) return { body: { ok: false, msg: '请求格式错误' }, changed: false };

    if (pathname === '/api/create') {
      const name = cleanName(body.name);
      if (!name) return { body: { ok: false, msg: '请输入临时ID' }, changed: false };
      const r = createRoom(name);
      if (r.err) return { body: { ok: false, msg: r.err }, changed: false };
      return { body: view(r.room, r.player), changed: true };
    }
    if (pathname === '/api/join') {
      const name = cleanName(body.name);
      if (!name) return { body: { ok: false, msg: '请输入临时ID' }, changed: false };
      const r = joinRoom(body.code, name);
      if (r.err) return { body: { ok: false, msg: r.err }, changed: false };
      return { body: view(r.room, r.player), changed: true };
    }
    if (pathname === '/api/action') {
      const g = who(searchParams);
      if (g.err) return { body: { ok: false, msg: g.err }, changed: false };
      const r = act(g.room, g.player, body);
      if (!r.ok) return { body: r, changed: false };
      if (r.gone) return { body: r, changed: true };
      return { body: view(g.room, g.player), changed: true };
    }
    return { body: { ok: false, msg: '接口不存在' }, changed: false };
  }

  function sweep(now) {
    const t = now == null ? Date.now() : now;
    for (const [code, room] of rooms) {
      if (t - room.touched > ROOM_TTL) rooms.delete(code);
    }
  }

  return { rooms, route, sweep, view, act, createRoom, joinRoom, applyCfg, VER, ROOM_TTL };
};
