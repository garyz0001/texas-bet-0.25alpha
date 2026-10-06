# 德州扑克 · 虚拟下注器

只管筹码，现实发牌。两种模式：

- **本地单机** —— 一台设备控制整张桌子，纯前端，不需要后端
- **房间模式** —— 每人一部手机，创建/加入房间，房主开桌、只有轮到的人能操作、摊牌由房主定胜负

## 本地跑起来

需要 [Node.js](https://nodejs.org)（LTS 即可）。

```bat
双击 启动服务器.bat
```

然后：

- 电脑打开 http://localhost:8080
- 同 WiFi 的手机打开 http://<电脑IP>:8080 （启动时会把局域网 IP 打印出来）

## 部署到网上（关键说明）

**GitHub Pages / Gitee Pages 是纯静态托管，跑不了 Node 后端。**
在那上面「本地单机」可以正常玩，但「创建房间」会提示没有后端 —— 这是平台限制，不是 bug。

想让房间功能在线可用，把**整个目录**部署到任意能跑 Node 的主机即可（后端和网页在同一处，`config.js` 不用改）：

### 方式 A：Render（推荐，有免费额度）

1. 把本目录推到你的 GitHub 仓库
2. Render 控制台 → **New → Blueprint** → 选这个仓库，它会读取 `render.yaml`
3. 部署完成后得到一个 `https://xxx.onrender.com`
4. 手机/电脑直接访问这个地址

### 方式 B：其它能跑 `npm start` 的主机

Railway、Fly.io、Zeabur、自己的 VPS 都行，启动命令就是 `node serve.js`。

### 方式 C：网页留在 GitHub Pages，后端单独部署

1. 把 `serve.js` 那套部署到方式 A 得到的地址
2. 编辑 GitHub Pages 上的 `config.js`：

```js
window.TEXAS_BET_API = 'https://xxx.onrender.com';
```

后端已开启跨域（CORS），可以直接连。

> 想确认后端通不通，访问 `https://你的后端/api/ping`，正常会返回 `{"ok":true,...}`。

## 测试

```bat
node test.js        # 引擎 18 场景
node fuzz.js        # 400 手随机对局不变量
node test-room.js   # 房间集成（起真实 HTTP 服务端）
node test-dom.js    # 界面冒烟（最小 DOM 桩跑真实 app.js）
node check-ui.js    # DOM id / 样式 / 引擎导出 / 需求存在性
```

## 版本

- `0.1alpha` / `0.11alpha` —— 本地单机、快捷额度舍零头、点按钮只填滑条
- `0.2alpha` —— 房间模式（创建/加入、房主制、轮到才能操作、房主定胜负）
- `0.25alpha` —— 滑条吸附大盲整数倍；静态托管下的后端探测与提示
