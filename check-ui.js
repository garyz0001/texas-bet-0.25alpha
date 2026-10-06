/* 静态契约检查：app.js 里引用的 DOM id / class 是否都在 index.html 里 */
const fs=require('fs');
const app=fs.readFileSync('app.js','utf8');
const html=fs.readFileSync('index.html','utf8');
const css=fs.readFileSync('style.css','utf8');
let fails=0;
const ids=new Set();
for(const m of app.matchAll(/\$\('([^']+)'\)/g)) ids.add(m[1]);
const htmlIds=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
const miss=[...ids].filter(i=>!htmlIds.has(i));
if(miss.length){console.log('FAIL app.js 引用但 index.html 缺少的 id: '+miss.join(', '));fails++;}
else console.log('ok   app.js 引用的 '+ids.size+' 个 id 全部存在于 index.html');

// index.html 里 class 是否有样式（至少出现一次）
const cls=new Set();
for(const m of html.matchAll(/class="([^"]+)"/g)) m[1].split(/\s+/).forEach(c=>c&&cls.add(c));
const noStyle=[...cls].filter(c=>!css.includes('.'+c));
if(noStyle.length){console.log('WARN index.html 中无样式的 class: '+noStyle.join(', '));}
else console.log('ok   index.html 的 '+cls.size+' 个 class 都在 style.css 有定义');

// app.js / serve.js 用到的引擎 API 是否都由 engine.js 导出
const eng=fs.readFileSync('engine.js','utf8');
const m=eng.match(/\n  return \{([\s\S]*?)\};\n\}\);\s*$/);
const exported=new Set((m?m[1]:'').split(',').map(s=>s.trim()).filter(Boolean));
const used=new Set();
for(const mm of app.matchAll(/\bE\.([A-Za-z_$][\w$]*)/g)) used.add(mm[1]);
for(const mm of fs.readFileSync('serve.js','utf8').matchAll(/\bE\.([A-Za-z_$][\w$]*)/g)) used.add(mm[1]);
for(const f of ['room-core.js','worker.mjs'])
  for(const mm of fs.readFileSync(f,'utf8').matchAll(/\bE\.([A-Za-z_$][\w$]*)/g)) used.add(mm[1]);
const bad=[...used].filter(u=>!exported.has(u));
if(bad.length){console.log('FAIL 引用了 engine.js 未导出的 API: '+bad.join(', '));fails++;}
else console.log('ok   引用的引擎 API ['+[...used].join(', ')+'] 全部已导出');

// 关键需求存在性检查（服务端相关会在 serve/room-core/worker 三个文件里找）
const SERVER_FILES = ['serve.js', 'room-core.js', 'worker.mjs'];
const need = [
  [/\/api\/create/,            '服务端 创建房间接口'],
  [/\/api\/join/,              '服务端 加入房间接口'],
  [/\/api\/ping/,              '服务端 探测接口 /api/ping'],
  [/HOST_ONLY/,                  '服务端 房主专属操作白名单'],
  [/st\.current !== seat/,      '服务端 轮到才可操作的校验'],
  [/只有房主可以操作/,           '服务端 房主权限报错文案'],
  [/bigCode/,   'index.html 创建后确认房间号'],
  [/myNameView/,'index.html 创建后确认临时ID'],
  [/inJoinCode/,'index.html 加入房间号输入'],
  [/inJoinName/,'index.html 加入临时ID输入'],
  [/homeHint/,  'index.html 静态托管提示节点'],
  [/config\.js/, 'index.html 引入 config.js'],
  [/canActNow/, 'app.js 客户端只在轮到时渲染操作'],
  [/openShowdown/, 'app.js 摊牌确认'],
  [/const snap = raw/, 'app.js 滑条吸附大盲整数倍'],
  [/NO_API/, 'app.js 区分静态托管与网络不通'],
];
for (const [re, name] of need) {
  let okHit = false;
  if (/bigCode|myNameView|inJoin|homeHint|config/.test(re.source)) {
    okHit = !!fs.readFileSync('index.html', 'utf8').match(re);
  } else if (/canActNow|openShowdown|snap|NO_API/.test(re.source)) {
    okHit = !!fs.readFileSync('app.js', 'utf8').match(re);
  } else {
    okHit = SERVER_FILES.some(f => !!fs.readFileSync(f, 'utf8').match(re));
  }
  if (!okHit) { console.log('FAIL 缺少 ' + name); fails++; }
  else console.log('ok   ' + name);
}

// Cloudflare 部署所需文件
for (const f of ['room-core.js', 'worker.mjs', 'wrangler.toml', 'tools/build.js', 'package.json', 'config.js', 'README.md']) {
  if (!fs.existsSync(f)) { console.log('FAIL 缺少部署文件 ' + f); fails++; }
  else console.log('ok   部署文件存在: ' + f);
}
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
if (!pkg.scripts || !pkg.scripts.build) { console.log('FAIL package.json 缺少 build 脚本（Cloudflare Pages 构建会失败）'); fails++; }
else console.log('ok   package.json 有 build 脚本 -> ' + pkg.scripts.build);
const wr = fs.readFileSync('wrangler.toml', 'utf8');
if (!/durable_objects\.bindings/.test(wr) || !/class_name\s*=\s*"RoomStore"/.test(wr)) {
  console.log('FAIL wrangler.toml 缺少 Durable Object 绑定'); fails++;
} else console.log('ok   wrangler.toml 已绑定 Durable Object RoomStore');
if (!/new_sqlite_classes\s*=\s*\[\s*"RoomStore"\s*\]/.test(wr)) {
  console.log('FAIL wrangler.toml 必须用 new_sqlite_classes（免费版 DO 会报 code 10097）'); fails++;
} else console.log('ok   wrangler.toml 用 new_sqlite_classes 建 DO（免费版要求）');
if (/new_classes\s*=/.test(wr)) { console.log('FAIL 不要写 new_classes，免费版不认'); fails++; }
if (!/class RoomStore/.test(fs.readFileSync('worker.mjs', 'utf8'))) {
  console.log('FAIL worker.mjs 没有导出 RoomStore'); fails++;
} else console.log('ok   worker.mjs 导出 RoomStore');

console.log('\n'+(fails?'X '+fails+' 项失败':'全部通过'));
process.exit(fails?1:0);
