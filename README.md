# 市场观察

## 页面

- `index.html` — 回调观察框架和美股风险指标。
- `world.html` — 环球指数、期货、外汇、国债收益率和本机持仓与自选。报价可访问 `scope=world`（每批 8 个代码）和 `scope=world-yields`，工具会标明市场当地报价时间。
- `portfolio.html` — 手动维护多账户持仓及现金，按选定币种计算市值、价格与汇率贡献、集中度、ETF 重叠和情景损失。空白价格日期或当日日期会访问 `scope=fx` 取公开市场汇率。历史价格日期默认使用 Frankfurter 的对应日期参考值。手动汇率优先。

组合数据和自选保存在当前浏览器。导入、编辑、分析和导出均在本地浏览器完成。环球市场按股票代码请求报价。请单独保管导出的个人持仓备份。模拟交易按账户和成交币种核对可用现金，允许先卖后买的净额模拟。ETF 间接敞口仅计已录入的基金成分。

## 回调观察框架

页面打开、恢复可见或点击刷新时，请求当时可取到的最新公开报价。页面可见时每分钟请求一次。SPYM 盘中图默认展示常规时段的 1 分钟行情，支持分钟 K 线。5 日图展示最近五个交易日的 5 分钟盘中走势及 K 线，1 月图为日线并随报价更新当日点位。已有部署需更新 Worker 才能使用 5 日盘中接口。行情可能延迟。信用利差、国债收益率和恐贪按各来源发布频率更新。

SPYM 主卡的 52 周回撤以最新报价对比过去 364 天内的最高日收盘价，达到或超过该高点时显示 0%。广度卡使用 [DeanFi 的标普 500 成分股统计](https://github.com/DeanFinancials/deanfi-data/tree/main/advance-decline)，比较当前读数与五个交易日前的百分点变化。VIX / VIX3M 使用 [Cboe 指数收盘数据](https://www.cboe.com/tradable-products/vix/vix-historical-data)（FRED 可作同口径备用来源），仅对齐同一交易日。新版指标接口是 `/api/market?scope=context`，网页可见时每五分钟请求，SPYM 回撤会随主报价刷新。

## 在本机刷新行情

直接打开 `dist/index.html` 时，地址栏以 `file://` 开头，显示随包下载的行情快照。联网后，用 Node.js 20 或更新版本，在解压出来的项目根目录运行：

```bash
npm run dev
```

打开 [http://127.0.0.1:3000](http://127.0.0.1:3000)。本地服务提供与私有预览相同的行情接口，不需要 npm 安装依赖或行情 API 密钥。要换端口，可运行 `npm run dev -- 3100`。

悬停指标可以查看定义和最新读数。点击指标可打开详情，源网站链接在详情里。小折线支持指针移动或键盘左右键查看点位。

## 发布到 GitHub Pages

把源码放在 GitHub 仓库的 `main` 分支，并在 **Settings → Pages → Source** 选择 **GitHub Actions**。项目页面也可以放在普通的仓库子路径里。

GitHub Pages 是静态托管。如果看到「GitHub Pages 尚未配置行情接口」，先访问当前页面的 `assets/live-config.js` 确认 `apiBase`。空值会显示快照，配置成功后页面才会请求 Worker。直接把网页上传到现有站点的 `market/` 子目录时，应改该子目录里的 `assets/live-config.js`。只有运行随包的发布工作流时，仓库变量才会写入页面配置。

盘中行情通过一个 HTTPS Worker 转发 Yahoo Finance、Nasdaq、CNN 和 FRED 的公开数据。直接从浏览器请求其中部分网站会被跨域限制拦截。本站的私有预览已内置同源行情接口。

如要在自己的 GitHub Pages 接上盘中行情：

1. 在仓库根目录运行 `npx wrangler deploy`，按 Cloudflare 的登录提示完成部署，记录它输出的 `https://…workers.dev` 地址。Worker 不需要行情 API 密钥，也不接收账户数据。
2. 在 GitHub 仓库的 **Settings → Secrets and variables → Actions → Variables** 新建 `MARKET_API_BASE`，填入 Worker 的 HTTPS 地址。也可直接在 `dist/assets/live-config.js` 设置 `apiBase`。
3. 在 **Actions → Update and deploy market dashboard** 运行工作流。打开 GitHub Pages 后，核对 SPYM 报价时间、分时图与刷新状态。接口可单独用 `/api/market?scope=spym` 核查。

GitHub Actions 在每周一至周五 14:43、22:43 UTC 更新日线资料，也支持手动运行。解压后可打开 `dist/index.html` 查看随包提供的行情和日线快照。访问失败时，页面保留最近可用读数。

公开行情以各来源提供的报价、时间和更新周期为准。日线脚本仅依赖 Python 标准库，可运行 `python3 scripts/update_market_data.py --check-only` 检查日线来源。

英数字体使用 Inter，中文使用 Noto Sans CJK SC 的页面子集。授权见 `dist/assets/INTER-LICENSE.txt` 和 `dist/assets/FONT-LICENSE.txt`。
