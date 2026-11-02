# 海克斯大乱斗外置助手：调研与实现依据

调研日期：2026-11-02。目标环境：Windows，用户确认使用腾讯国服客户端。以下区分公开文档、已抓取验证的数据，以及仍需实局验证的部分。

## 结论

采用 Electron 独立透明置顶窗口承载浮层；以 OP.GG 提供静态攻略资料，以 LCU / Live Client 提供当前英雄与阶段，以本地 OCR 读取屏幕上可见的强化符文名称。这三类数据各自有清晰边界，不能用一个接口代替全部信息。

## 参考项目

仅参考公开说明与架构，没有直接复制其他项目的业务源码。

| 项目 | 公开说明中的做法 | 对本项目的启发 |
| --- | --- | --- |
| [OP.GG Desktop](https://op.gg/desktop/en/downloads) / [官方覆盖层支持表](https://help.op.gg/hc/en-us/articles/63676787584281-Overlay-support-by-game-mode) | 官方客户端提供按模式区分的覆盖层功能，海克斯模式页面也链接到下载入口 | 有真实产品形态可以参考；官方产品能力不代表开放第三方 API 或国服兼容承诺 |
| [Sygnano/aram-mayhem-tracker](https://github.com/Sygnano/aram-mayhem-tracker) | Tauri/Rust、LCU、Live Client、局部截图文字识别、ARAMKit 统计；README 说明无边框／窗口模式要求 | 状态读取和卡片识别应分开；不同语言、缩放和客户端版本需要真实画面验证 |
| [CyberKird/aram-mayhem-helper](https://github.com/CyberKird/aram-mayhem-helper) | Python 引擎配 Electron 界面，Windows 原生 OCR，按显示器定位 | Electron 适合独立浮层；原生 OCR 也是后续替代方案；不把“已提供的选项”和“最终选择”混为一谈 |
| [zp96-cmd/mayhem-overlay](https://github.com/zp96-cmd/mayhem-overlay) | 透明置顶窗口、鼠标穿透、快捷键、Tesseract.js OCR、手动名称输入、布局设置 | 本地 JavaScript 栈可形成可运行原型，手动选择是识别失败时的必要补充 |

这些开源项目的统计来源和评分算法不同。本实现按用户要求使用 OP.GG，没有混入它们的 ARAMKit／aramgg 统计，也没有复用其自动确认、自动换英雄、写入装备页等操作。

## OP.GG 实际能取得什么

验证地址：

- [模式首页](https://op.gg/zh-cn/lol/modes/aram-mayhem)
- [九尾妖狐强化符文](https://op.gg/zh-cn/lol/modes/aram-mayhem/ahri/augments)
- [九尾妖狐出装](https://op.gg/zh-cn/lol/modes/aram-mayhem/ahri/build)

实际 HTTP 200 响应里包含 Next.js Flight 数据。程序只抽取其中的 JSON 字符串记录，不执行页面脚本。英雄和强化符文从结构化条目归一化；出装从 HTML 表格中读取图片 ID、名称及分组顺序。

| 信息 | 当前取法 | 核实结果 |
| --- | --- | --- |
| 英雄标识 | `champion_id`、`key`、中文 `name` | 173 个英雄，可用数值 ID 对齐 LCU |
| 强化符文 | `id`、`name`、`rarity`、`tier`、`desc`、图标 | 首页 263 个具备名称与品质的完整条目 |
| 英雄专属符文 | `/{champion}/augments` | 阿狸 209 条，档位可与全局档位不同 |
| 品质 | 当前页面的 `rarity` | 1 白银、4 黄金、8 彩色；未知值保留为未知，不能默认推断 |
| 出装 | `/{champion}/build` 表格 | 出门装、鞋子、核心装备，保留页面原始顺序 |
| 数据版本 | 页面标题和资源路径 | 当前实取为 16.21；不把本地日期当成补丁版本 |
| 胜率和样本量 | 当前页面没有核实到可直接使用的明确统计字段 | 不展示；内部 `performance` 大于 100 的条目也存在，尤其不能直接当成胜率 |

OP.GG 的名称和描述存在「?」变量及区域翻译差异。原文保留，不猜数值。页面有少数仅含 ID、缺少名称的条目，归一化时过滤。

访问策略：每个页面缓存 6 小时，串行请求、至少间隔 1 秒、20 秒超时、响应大小限制、失败后 2 分钟退避；失败不覆盖最近成功缓存。刷新只针对目录和当前英雄，避免每次启动抓取所有英雄。请求不包含本地账号、LCU 密码或截图。

这条路径是已验证的公开页面解析，不是官方开放 API。网页改版会影响解析，因此校验失败时明确回退缓存；不能把页面可访问等同于获得商业再分发许可。

## 国服当前英雄和对局阶段

Riot 对 [League Client API 的说明](https://developer.riotgames.com/docs/lol#league-client-api) 明确将其列为未承诺支持的服务。不同国服版本需实测。

1. 后台读取 `LeagueClientUx.exe` / `LeagueClient.exe` 的进程启动信息，仅寻找本机连接端口和 token；也支持指定 `lockfile`。不遍历磁盘、不读游戏进程内存。
2. 对 `https://127.0.0.1:<port>` 发送固定白名单的 GET 请求，认证只留在主进程。
3. `/lol-gameflow/v1/gameflow-phase` 获取阶段；`/lol-gameflow/v1/session` 获取队列和游戏标识；`/lol-champ-select/v1/session` 通过 `localPlayerCellId` 找到自己的英雄。
4. 游戏开始后，使用 [Live Client Data API](https://developer.riotgames.com/docs/lol#game-client-api_live-client-data-api) 的 `activeplayer`、`playerlist`、`gamestats`。优先通过 `rawChampionName` 对齐英雄，避免中文展示名变化。

游戏内接口地址是 `https://127.0.0.1:2999`，只在对局内可用。自签名证书例外仅作用于这些固定回环请求。

目前按队列 2400 或队列名称中的 Mayhem／海克斯确认模式；普通 ARAM 队列 450 不自动开启。只取得 Live Client 信息时，不把 `gameMode=ARAM` 当作海克斯模式的充分证据，提供本局手动确认。

## 当前三选一从哪里来

官方 [Live Client 端点文档](https://developer.riotgames.com/docs/lol#game-client-api) 列出了当前玩家、玩家列表、装备、事件等内容，没有提供可据此承诺的“当前三选一强化符文”接口。几个参考项目也分别采用屏幕识别。由此选择本地 OCR，是本实现的工程判断，不代表断言所有区域客户端永远不存在新接口。

本版链路：Electron `desktopCapturer` 获取窗口缩略图 → 选择游戏标题为 `League of Legends (TM) Client` 的窗口 → 按比例裁剪中央区域 → Windows 原生中文 OCR（失败时回退 Tesseract 中文模型）→ 规范化标点与空格 → OP.GG 名称词典匹配。

实测后调整了引擎优先级：本机已安装 `zh-Hans-CN` 的 Windows 识别语言，使用 [Windows.Media.Ocr.OcrEngine](https://learn.microsoft.com/en-us/uwp/api/windows.media.ocr.ocrengine) 在三条合成名称中得到 3/3 匹配；Tesseract 的同一测试只有 2/3 精确匹配，会误读「魔法飞弹」。因此以原生引擎为主，备用引擎结果仍需核对。原生引擎由隐藏的 PowerShell 辅助进程调用，读取裁剪区域的本地临时 PNG，完成后删除，不操作窗口焦点或模拟输入。

仅游戏窗口图像进入识别器。Electron 在枚举缩略图时可能取得其他窗口的缩略图；这些不会进入 OCR，不保存、不上传。识别文本仅保留于本次运行内存。导入图片由用户主动点击选择。

名称模糊匹配的相似度不是准确率。模糊结果只列为候选，用户确认；仅有恰好三个无歧义的名称结果时，才填入三个比较位。没有自动点击游戏卡片，也没有推断最终已选择的强化符文。

本版局限：窗口标题过滤可能受地区版本影响；DirectX 独占全屏、黑屏、遮挡、HUD 比例和游戏字体均可能影响识别。没有实际国服截图时，不能声称 OCR 已完成实局校准。

## 外置浮层怎么做

按 [Electron 窗口文档](https://www.electronjs.org/docs/latest/api/browser-window) 创建独立 `BrowserWindow`：

```js
new BrowserWindow({
  transparent: true,
  frame: false,
  alwaysOnTop: true,
  focusable: false,
  skipTaskbar: true,
  show: false,
});
overlay.setIgnoreMouseEvents(true, { forward: true });
overlay.showInactive();
```

[Electron 官方鼠标穿透说明](https://www.electronjs.org/docs/latest/tutorial/custom-window-interactions#click-through-windows) 支持这种外置窗口路径。控制面板与浮层分开，搜索和设置在控制面板完成，浮层只读，不占用游戏输入。

窗口按 Electron 的显示器逻辑坐标定位，支持负坐标的第二显示器。当前可设置四个角落和透明度，不需要移动用户鼠标。默认程序仅托盘启动；自动浮层仅在确认的海克斯选人／对局阶段出现。独占全屏下不保证覆盖；当前也没有实现对游戏窗口矩形的自动跟随。

## 为什么先选 Electron

| 方案 | 优势 | 本次取舍 |
| --- | --- | --- |
| Electron | 透明窗口、热键、网页 UI、Node 网络与 OCR 集成快；现有项目可参考 | 作为本次可运行原型；代价是包体与内存较大 |
| Tauri + Rust | 应用壳轻，可细致控制 Windows API | 适合后续优化；需要额外处理 Rust、WebView2、OCR 和 Windows 打包链 |
| .NET / WPF | Windows 原生置顶窗与 WinRT OCR 方便 | 也是可行替代，UI 及页面解析体系需要另建 |
| Overwolf 平台 | 已有覆盖层与游戏事件生态 | 需要核实支持的模式、区域、审核和分发要求，本次不引入平台依赖 |

外置窗口、官方接口和 OCR 并不自动等于平台审核通过。[Riot 第三方产品政策](https://developer.riotgames.com/policies/general) 要求产品登记与审核；[近期官方内存访问说明](https://support.riotgames.com/en-us/riot/performance/game-memory-access-removed-for-third-party-apps)也强调向允许的接口迁移。实现因此限定为公开资料与本机只读接口，未采用注入、Hook、内存读取或自动输入。国服公开分发还需独立核对腾讯要求。

## 验证层级

本机已验证公开页面可访问、结构化数据解析、缓存回退、名称匹配、LCU 凭据解析与白名单、隐藏窗口中的 UI 交互与浮层渲染。OCR 通过合成中文图片验证时，报告会明确写为合成测试。

真实国服登录、选人、进入海克斯对局、不同分辨率卡片识别、快捷键在游戏前台的可用性，以及实际游戏画面上方的叠加，均需要在对应环境中实测。当前没有运行中的游戏，这些结论保持待验证。
