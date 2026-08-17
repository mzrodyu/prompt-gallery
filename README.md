<h1 align="center">🎨 PromptGallery</h1>

<p align="center">
  自托管的 <b>AI 绘画作品收藏库</b> —— 收藏你的作品，记录提示词、参数与灵感。<br/>
  <i>A self-hosted gallery for your AI-generated art. Keep the images, the prompts, and the params — all in one place.</i>
</p>

<p align="center">
  <img alt="Node" src="https://img.shields.io/badge/Node-%E2%89%A522.5-3c873a">
  <img alt="Stack" src="https://img.shields.io/badge/stack-Express%20%2B%20SQLite-000">
  <img alt="Deps" src="https://img.shields.io/badge/native%20deps-0-brightgreen">
  <img alt="PRs" src="https://img.shields.io/badge/PRs-welcome-blueviolet">
</p>

> 把散落在各处的 MidJourney / NovelAI / ComfyUI / SD 出图，连同提示词和参数一起收进一个漂亮、可搜索、可分享的画廊。纯 Node + 原生前端，**无框架、无原生依赖、SQLite 单文件存储**，一条命令跑起来。

## ✨ 特性

- 🖼️ **多来源收藏** —— MidJourney / Niji、NovelAI、ComfyUI、Stable Diffusion，各自的参数字段分别记录
- 🧠 **提示词 & 参数管理** —— 粘贴带 `--ar --niji --s` 等参数的提示词，**一键智能识别自动填入**
- 🔎 **搜索 / 筛选 / 排序** —— 按来源、分类、标签、关键词过滤，最新 / 最早 / 最热排序
- 🏷️ **标签 & 分类** —— 管理员可维护标签与分类，支持重命名级联、拖拽排序
- 👥 **用户系统** —— 注册审核、角色权限、作品可见性（公开 / 登录可见 / 私有）、个人主页与头像
- ❤️ **点赞 · 💬 评论 · ⭐ 评分** —— 评论可开审核；1–5 星评分
- 🃏 **卡牌 / 抽卡主题** —— 稀有度描边、全息光泽、星级展示，出图秒变收藏卡
- ⚡ **为规模而生** —— SQLite 存储 + 图片外置到磁盘，上万用户、海量图也不卡（详见下方性能）
- 🪶 **极简依赖** —— 只有 express / bcryptjs / jsonwebtoken，数据库用 Node 内置 `node:sqlite`，**零原生编译**

## 🚀 快速开始

```bash
git clone https://github.com/mzrodyu/prompt-gallery.git
cd prompt-gallery
npm install
npm start          # 默认 http://localhost:3000
```

第一个注册的用户会自动成为管理员。就这么简单。

<!-- APPEND_MARKER -->

## ⚡ 性能

图片不再内联进 JSON、也不再"改一次全量重写"。元数据进 SQLite（带索引），图片作为独立文件存盘：

| 操作 | 旧（单 JSON 全量重写） | 现在（SQLite） |
|---|---|---|
| 一次点赞 | ~426 ms，阻塞事件循环 | **~0.1 ms** |
| 列表查询（筛选+排序+分页） | 全量扫描+复制 | **~3 ms** |
| 5000 张图的数据文件 | 244 MB 单文件 | **2.2 MB** 数据库 + 图片各自成文件 |

> 单次点赞快约 **4000×**，且不再卡住其它请求。`npm run bench` 可自测。

## 🛠️ 部署

支持任意能跑 Node ≥ 22.5 的环境。反向代理（Nginx / Caddy / 1Panel）指到应用端口即可。

<details>
<summary><b>1Panel</b></summary>

1. **网站 → 运行环境 → Node.js**，安装一个 **≥ 22.5** 的版本（用了 `node:sqlite`，低于此版本无法启动）
2. 服务器上 `git clone` 项目并 `npm install`
3. **Node 项目**：项目目录指向代码、启动命令 `npm start`、设置端口与环境变量
4. **反向代理**：新建网站反代到 `http://127.0.0.1:<端口>`，申请 HTTPS
5. 固定 `DATA_DIR`（数据库 + 图片都在这），并定期备份该目录

</details>

<details>
<summary><b>PM2</b></summary>

```bash
JWT_SECRET=改成你的随机串 PORT=3000 pm2 start server.js --name gallery
```
</details>

## 🔧 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `3000` | 监听端口 |
| `DATA_DIR` | `./data` | 数据目录（`gallery.db` + `images/`），**务必持久化** |
| `JWT_SECRET` | 自动生成 | 登录令牌密钥，建议显式设置一串随机值 |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | 无 | 设置后自动创建 / 提升该用户为管理员 |

首次启动若检测到旧版 `data/*.json`，会自动迁移进 SQLite 并把旧文件改名为 `*.bak`。

## 🧱 技术栈

- **后端**：Node.js + Express，存储用内置 `node:sqlite`（WAL、预编译语句、事务）
- **前端**：原生 HTML / CSS / JS，无构建、无框架；卡片懒加载 + 无限滚动
- **测试**：Playwright 端到端 + `scripts/smoke.js` 接口冒烟

## 🧪 开发

```bash
npm run dev        # 启动
npm run smoke      # 接口契约冒烟测试
npm run bench      # 性能基准
npm run test:e2e   # Playwright 端到端
```

## 🤝 贡献 & 许可

欢迎 Issue / PR。喜欢的话点个 ⭐ 支持一下～

