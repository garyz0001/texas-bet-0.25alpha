/* 把运行时要用的静态文件复制到 public/（Cloudflare Pages / Workers 的资源目录） */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'public');
const FILES = ['index.html', 'style.css', 'app.js', 'engine.js', 'config.js'];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const f of FILES) {
  const src = path.join(root, f);
  if (!fs.existsSync(src)) { console.error('缺少文件: ' + f); process.exit(1); }
  fs.copyFileSync(src, path.join(out, f));
}
console.log('build -> public/  (' + FILES.join(', ') + ')');
