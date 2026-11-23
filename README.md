# 美股市场观察

页面打开、恢复可见或点击刷新时，请求当时可取到的最新公开报价。页面可见时每分钟请求一次。SPYM 盘中图默认展示常规时段的 1 分钟行情，支持分钟 K 线及 5 日、1 月日线。行情可能延迟。信用利差、国债收益率和恐贪按各来源发布频率更新。

## 在本机刷新行情

直接打开 `dist/index.html` 时，地址栏以 `file://` 开头，显示随包下载的行情快照。联网后，用 Node.js 20 或更新版本，在解压出来的项目根目录运行：

```bash
npm run dev
```

打开 [http://127.0.0.1:3000](http://127.0.0.1:3000)。本地服务提供与私有预览相同的行情接口，不需要 npm 安装依赖或行情 API 密钥。要换端口，可运行 `npm run dev -- 3100`。

悬停指标可以查看定义和最新读数。点击指标可打开详情，源网站链接在详情里。小折线支持指针移动或键盘左右键查看点位。

## 发布到 GitHub Pages

把源码放在 GitHub 仓库的 `main` 分支，并在 **Settings → Pages → Source** 选择 **GitHub Actions**。项目页面也可以放在普通的仓库子路径里。

GitHub Pages 是静态托管。盘中行情通过一个 HTTPS Worker 转发 Yahoo Finance、Nasdaq、CNN 和 FRED 的公开数据。直接从浏览器请求其中部分网站会被跨域限制拦截。本站的私有预览已内置同源行情接口。

如要在自己的 GitHub Pages 接上盘中行情：

1. 在仓库根目录运行 `npx wrangler deploy`，按 Cloudflare 的登录提示完成部署，记录它输出的 `https://…workers.dev` 地址。Worker 不需要行情 API 密钥，也不接收账户数据。
2. 在 GitHub 仓库的 **Settings → Secrets and variables → Actions → Variables** 新建 `MARKET_API_BASE`，填入 Worker 的 HTTPS 地址。也可直接在 `dist/assets/live-config.js` 设置 `apiBase`。
3. 在 **Actions → Update and deploy market dashboard** 运行工作流。打开 GitHub Pages 后，核对 SPYM 报价时间、分时图与刷新状态。接口可单独用 `/api/market?scope=spym` 核查。

GitHub Actions 在每周一至周五 14:43、22:43 UTC 更新日线资料，也支持手动运行。解压后可打开 `dist/index.html` 查看随包提供的行情和日线快照。访问失败时，页面保留最近可用读数。

公开行情以各来源提供的报价、时间和更新周期为准。日线脚本仅依赖 Python 标准库，可运行 `python3 scripts/update_market_data.py --check-only` 检查日线来源。

字体使用 Noto Sans CJK SC 的页面子集，授权见 `dist/assets/FONT-LICENSE.txt`。
