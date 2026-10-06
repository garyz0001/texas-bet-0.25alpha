/* =========================================================
   Cloudflare Worker（0.25alpha）
   - /api/*  -> Durable Object「RoomStore」：房间逻辑 + 持久化
   - 其它路径 -> 静态资源（wrangler.toml 里的 [assets]）
   房间逻辑复用 room-core.js，和本地 serve.js 完全一致。

   部署：  npm run build && npx wrangler deploy
   （首次需要 npx wrangler login）
   ========================================================= */
import createCore from './room-core.js';
import Engine from './engine.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...CORS,
    },
  });
}

/* 单例 Durable Object：所有房间都放在这一个实例里，
   每个请求串行执行 —— 和本地 Node 版一样，天然没有并发写冲突。 */
export class RoomStore {
  constructor(state, env) {
    this.state = state;
    this.core = null;
  }
  async load() {
    if (this.core) return this.core;
    this.core = createCore(Engine);
    try {
      const raw = await this.state.storage.get('rooms');
      if (raw) for (const k of Object.keys(raw)) this.core.rooms.set(k, raw[k]);
    } catch (e) { /* 首次运行，还没有数据 */ }
    return this.core;
  }
  /* 只在状态真的变了才落盘；轮询不写，避免无谓开销 */
  async persist() {
    const obj = {};
    for (const [code, room] of this.core.rooms) {
      const copy = Object.assign({}, room);
      if (copy.state) {
        // history 是撤销快照，可能很大且只在本手内有意义 —— 不落盘
        const st = Object.assign({}, copy.state);
        delete st.history;
        copy.state = st;
      }
      obj[code] = copy;
    }
    try { await this.state.storage.put('rooms', obj); } catch (e) { /* 存储满了也不影响当前对局 */ }
  }
  async fetch(request) {
    const url = new URL(request.url);
    let body = null;
    if (request.method === 'POST') {
      try { body = JSON.parse(await request.text() || '{}'); }
      catch (e) { return json({ ok: false, msg: '请求格式错误' }); }
    }
    const core = await this.load();
    core.sweep();
    const out = core.route(request.method, url.pathname, url.searchParams, body);
    if (out.changed) await this.persist();
    return json(out.body, out.status);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    if (url.pathname.indexOf('/api/') === 0) {
      const id = env.ROOMS.idFromName('texas-bet-rooms');
      return env.ROOMS.get(id).fetch(request);
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not Found', { status: 404, headers: CORS });
  },
};
