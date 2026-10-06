# 德州扑克 · 虚拟下注器

只管筹码，现实发牌。两种模式：

- **本地单机** —— 一台设备控制整张桌子，纯前端，不需要后端
- **房间模式** —— 每人一部手机，创建/加入房间，房主开桌、只有轮到的人能操作、摊牌由房主定胜负

版本：**0.25alpha**

## 本地跑起来

需要 [Node.js](https://nodejs.org) 18+（LTS 即可）。

```bat
双击 启动服务器.bat
```

- 电脑：http://localhost:8080
- 同 WiFi 手机：http://<电脑IP>:8080（启动时会打印局域网 IP）

## 部署到网上

### ⚠️ 先说清楚：纯静态托管没有后端

GitHub Pages、Gitee Pages，以及**没配后端的 Cloudflare Pages**，都是纯静态的，跑不了 Node。
在那上面「本地单机」正常，「创建房间」会提示没有后端（前端探测到后会直接在首页说明）。

想让房间功能可用，必须把 `serve.js` 这套 API 也部署上去。项目里已经分好工：

| 文件 | 作用 |
|---|---|
| `room-core.js` | 房间逻辑核心，**平台无关**，本地和 Cloudflare 共用同一份 |
| `serve.js` | 本地 Node 版（静态 + API） |
| `worker.mjs` | Cloudflare Worker 版（静态 + API + Durable Object 持久化） |
| `wrangler.toml` | Cloudflare 配置：静态资源目录 + Durable Object 绑定 |
| `tools/build.js` | `npm run build`，把静态文件复制到 `public/` |

### 方式 A：Cloudflare（推荐）

```bash
npm run build          # 生成 public/
npx wrangler login     # 首次需要，浏览器里授权
npm run deploy         # = npm run build && npx wrangler deploy
```

部署完得到 `https://texas-bet.<你的子域>.workers.dev`，直接打开就能用。

- 静态网页由 Workers 静态资源提供
- `/api/*` 走 **Durable Object**，房间状态自动持久化，DO 被回收后房间还在
- 首次 `wrangler deploy` 会自动创建 Durable Object 迁移，不用手动跑 SQL

**用 GitHub 连 Cloudflare 自动部署**（不用本地装 wrangler）：
Workers & Pages → Create → Worker → Connect to Git → 选仓库，然后：
- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`

> 如果你只想用 **Cloudflare Pages**（纯静态、没有房间功能）：
> Build command 填 `npm run build`，Output directory 填 `public`。
> 构建就能过，但房间按钮会提示没有后端 —— 想要房间请用上面的 Worker 方式。

### 方式 B：Render（也是一键）

仓库里已带 `render.yaml`：Render 控制台 → New → Blueprint → 选仓库即可，
得到 `https://xxx.onrender.com`。

### 方式 C：网页和后端分开放

网页留在任意静态托管，后端单独部署，然后编辑 `config.js`：

```js
window.TEXAS_BET_API = 'https://你的后端地址';
```

后端已开启跨域（CORS），可以直接连。

> 检查后端通不通：访问 `<后端>/api/ping`，正常返回 `{"ok":true,...}`。

## 测试

```bat
node test.js         # 引擎 18 场景
node fuzz.js         # 400 手随机对局不变量
node test-room.js    # 本地 Node 后端集成（起真实 HTTP 服务端）
node test-dom.js     # 界面冒烟（最小 DOM 桩跑真实 app.js）
node test-worker.js  # Cloudflare 版（跑真实 worker.mjs + 模拟 Durable Object）
node check-ui.js     # DOM id / 样式 / 引擎导出 / 需求存在性 / 部署文件
```

## 版本

- `0.1alpha` / `0.11alpha` —— 本地单机、快捷额度舍零头、点按钮只填滑条
- `0.2alpha` —— 房间模式（创建/加入、房主制、轮到才能操作、房主定胜负）
- `0.25alpha` —— 滑条吸附大盲整数倍；静态托管探测与提示；**Cloudflare Worker 版后端**
