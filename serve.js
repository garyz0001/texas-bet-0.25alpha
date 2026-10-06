'use strict';
/* =========================================================
   德州扑克虚拟下注器 · 本地服务器（0.25alpha）
   - 静态文件服务
   - 房间 API：/api/ping /api/state /api/create /api/join /api/action
   房间逻辑全部在 room-core.js（与 Cloudflare 版共用同一份），
   规则唯一权威是 engine.js。
   用法：双击 启动服务器.bat，或 node serve.js
   ========================================================= */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const E = require('./engine.js');
const createCore = require('./room-core.js');

const PORT = Number(process.env.PORT) || 8080;
const DIR = __dirname;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.toml': 'text/plain; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
};

const core = createCore(E);
const VER = core.VER;

function json(res, obj, status) {
  const b = Buffer.from(JSON.stringify(obj));
  res.writeHead(status || 200, {
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

async function api(req, res, url) {
  let body = null;
  if (req.method === 'POST') {
    try { body = JSON.parse((await readBody(req)) || '{}'); }
    catch (e) { return json(res, { ok: false, msg: '请求格式错误' }); }
  }
  const out = core.route(req.method, url.pathname, url.searchParams, body);
  json(res, out.body, out.status);
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
  // 网页和后端分开放（如 GitHub Pages / Cloudflare Pages + 独立后端）时需要跨域
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
    api(req, res, url).catch(() => {
      try { json(res, { ok: false, msg: '服务器内部错误' }); } catch (e) {}
    });
    return;
  }
  serveStatic(req, res, url);
});

/* 回收长时间无人活动的房间 */
const sweeper = setInterval(() => core.sweep(), 10 * 60 * 1000);
if (sweeper.unref) sweeper.unref();

function banner() {
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list || []) if (n.family === 'IPv4' && !n.internal) ips.push(n.address);
  }
  console.log('');
  console.log('  德州扑克虚拟下注器 · ' + VER + ' · 已启动');
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
  server.listen(PORT, '0.0.0.0', banner);
}

module.exports = {
  createServer: () => server,
  rooms: core.rooms,
  core: core,
  VER: VER,
};
