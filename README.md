# 市场观察

## 页面

- `framework.html` — 回调观察框架和美股风险指标。旧首页 `index.html` 会跳转。
- `world.html` — 地图和分区表展示环球指数与股票持仓。地图按城市经纬度定位指数。悬停市场区域或选中圆点可查看当地指数和组合分析中的同一上市地持仓。陆地和交互边界使用 [Natural Earth](https://www.naturalearthdata.com/downloads/110m-cultural-vectors/) 数据。行情接口为 `scope=world`（每批 8 个代码）。南非和埃及指数使用 Yahoo Finance；俄罗斯 MOEX 使用交易所日收盘，接口暂不可用时显示带日期的收盘快照。ADR 按证券代码自动识别。页面内置发行人确认的上市地，并缓存成功的核对结果。`scope=adr` 按代码查询 Citi 存托凭证目录，再用 OpenFIGI 的原股 ISIN 匹配上市市场。原市场详情分别列出原股和持有 ADR 的报价。
- `portfolio.html` — 手动维护多账户持仓及现金，按选定币种计算市值、价格与汇率贡献、集中度、ETF 重叠和情景损失。双层环形图内圈是分类，外圈是具体持仓，账面现金与现金替代合并在现金类。空白价格日期或当日日期会访问 `scope=fx` 取公开市场汇率。历史价格日期默认使用 Frankfurter 的对应日期参考值。手动汇率优先。

## 用自己的持仓

朋友可以在自己的浏览器打开 [GitHub Pages 组合分析](https://yunzhegao.github.io/market/portfolio.html)。静态版将持仓保存在当前浏览器。解压源码包后，也可按下文启动本地服务，打开 `/portfolio.html`。

1. 点「手动录入」或「编辑持仓」，填写账户名称、证券代码、类型、币种和数量，再保存。现金选「现金」，数量填现金金额。自动行情拿不到时，可以手填现价和前收。填写成本可计算未实现盈亏。
2. 想批量录入时，点「下载示例 JSON」，将虚构的账户和持仓改成自己的，再点「导入 JSON」。导入会替换当前组合，有旧数据时可先用「导出备份」保存一份。备份文件名和文件内容都标有组合名称与导出时间，时间以浏览器本地时间为准。组合名称可在「编辑持仓」中修改。
3. 点击「载入演示数据」可体验计算与换仓模拟。「退出演示」会回到上次保存的组合。

下面是可以导入的最小示例，含一笔 ETF 和一笔现金。

```json
{
  "base": "USD",
  "positions": [
    {"account": "示例账户", "symbol": "SPY", "kind": "etf", "currency": "USD", "quantity": 2},
    {"account": "示例账户", "kind": "cash", "currency": "USD", "quantity": 500}
  ]
}
```

管理站连接数据库时，编辑和导入会保存到 D1。访客用各自的浏览器打开 GitHub Pages，即可独立录入并保存。自动行情只向行情接口发送证券代码。Yahoo Finance 的美股盘前、盘中、盘后和 SGX 报价均带时间，SGX 和港股公开报价分别延迟约 20 和 15 分钟。

「同一时点净值」按新加坡时间每日 06:00 前最后可用的 15 分钟行情与历史汇率，补算最近 30 个估值日。已有持仓记录的日期采用当时的证券数量和现金余额，更早的日期按首次回算时的持仓估算并标为虚线。保存持仓自动更新适用的估值日快照，后续变更不会改写已过估值时点的持仓。买卖、入出金后应在下一次估值前保存证券及现金余额。持仓记录随备份导出，并在有私有数据库的站点随持仓一并保存。估值缓存保存在浏览器，切换显示币种时可按原持仓快照重算。缺少历史行情或汇率的日期留空。净值含入出金，区间变动与最大回撤优先按有持仓记录的区间计算。自建行情接口需支持 `scope=valuation`。

「展示设置」预览证券代码、名称、类别和权重，可保存展示内容或停止展示。GitHub Pages 是静态托管，要在公开站展示该快照时，从设置导出 `portfolio-public.json`，放到 `dist/` 后重新发布。更新持仓不自动改变已公开的快照。请单独保管导出的完整持仓备份。模拟交易按账户和成交币种核对可用现金，允许先卖后买的净额模拟。ETF 间接敞口仅计已录入的基金成分。

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

全站使用 Noto Sans SC 可变字体。常用简繁字、标点和英数字随站点提供，其余字形按需从同一字体的官方 Google Fonts 资源加载。授权见 `dist/assets/FONT-LICENSE.txt`。
