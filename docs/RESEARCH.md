# 海克斯大乱斗外置助手：v0.2 调研与实现依据

更新日期：2026-11-02。目标环境：Windows、腾讯国服客户端。公开仓库：[Sskift/hexthon](https://github.com/Sskift/hexthon)。

## 架构选择

Electron 独立透明置顶窗口承载浮层；OP.GG 提供表现档位、英雄排名和出装；LCU / Live Client 提供本机阶段、英雄、队伍和装备；局部 OCR 获取屏幕上可见的三选一卡片。Win32 辅助进程被动观察窗口位置与点击状态，将卡片几何和游戏窗口对齐。

这些来源各自回答不同问题：攻略页面不知道当前装备，Live Client 没有可据此承诺的三选一接口，点击后画面消失也只足以形成“自动推断”，不能冒充本地接口确认。

## 参考项目

参考了以下公开说明与架构，没有直接复制其业务源码。

| 项目 | 参考内容 | 本项目采用的方向 |
| --- | --- | --- |
| [OP.GG Desktop](https://op.gg/desktop/en/downloads) / [覆盖层支持说明](https://help.op.gg/hc/en-us/articles/63676787584281-Overlay-support-by-game-mode) | 按模式提供攻略覆盖层的产品形态 | 根据选人、普通对局和三选一卡片切换展示；官方客户端能力不等于第三方开放 API |
| [Sygnano/aram-mayhem-tracker](https://github.com/Sygnano/aram-mayhem-tracker) | Tauri/Rust、LCU、Live Client、局部截图文字识别 | 对局状态读取与可见卡片识别分开，保留区域与缩放兼容边界 |
| [CyberKird/aram-mayhem-helper](https://github.com/CyberKird/aram-mayhem-helper) | Python / Electron、Windows OCR、显示器定位 | 使用 Windows 原生 OCR；区分出现过的卡片和最终选中记录 |
| [zp96-cmd/mayhem-overlay](https://github.com/zp96-cmd/mayhem-overlay) | 透明置顶、鼠标穿透、快捷键和 Tesseract.js | 独立 JavaScript 桌面浮层、本地 OCR 备用引擎与校正入口 |

按需求保持 OP.GG 为表现数据来源，没有混入参考项目的 ARAMKit / aramgg 统计。没有自动选卡、自动换英雄、写入装备页或自动购买。

## OP.GG 数据

已读取并验证的页面包括[模式首页](https://op.gg/zh-cn/lol/modes/aram-mayhem)、[阿狸符文](https://op.gg/zh-cn/lol/modes/aram-mayhem/ahri/augments)、[阿狸出装](https://op.gg/zh-cn/lol/modes/aram-mayhem/ahri/build)。

HTTP 页面包含 Next.js Flight 数据。程序仅解析其中的 JSON 字符串，不执行页面 JavaScript。英雄与符文来自结构化条目；出装从 HTML 表格提取物品 ID、名称和顺序。

| 信息 | 实际取法与边界 |
| --- | --- |
| 英雄 | `champion_id`、`key`、`name`、`tier`、`rank`；快照含 173 个英雄 |
| 符文 | `id`、`name`、`rarity`、`tier`、`desc`；首页含 263 个完整条目 |
| 英雄专属档位 | `/{champion}/augments`；阿狸快照 209 条，与通用档位可以不同 |
| 品质 | 当前值 1 白银、4 黄金、8 彩色；未知值不猜测 |
| 出装 | `/{champion}/build` 的出门装、鞋子和核心装备分组 |
| 补丁 | 页面标题与资源路径；当前内置快照为 16.21 |
| 实际胜率 | 当前页面没有核实到可直接使用的明确字段，显示“未公开” |

保留原描述中的 `?` 和翻译差异，不补全未知数值。`performance`、`popular` 不解释为胜率或选取率；部分 `performance` 超过 100，不能当作百分比。没有补造样本量。

访问策略为每页缓存 6 小时、串行请求至少间隔 1 秒、20 秒超时、响应大小限制、失败后 2 分钟退避。失败保留最近成功缓存。启动先使用本地资料，自动监控不等待页面请求完成；只更新目录和当前英雄，避免抓取全英雄页面。请求不包含本地账号、认证或截图。

该来源属于公开页面解析，网页改版可能使解析失效，且没有声明是国服统计。来源 URL、时间和补丁随归一化数据保存。

## 描述性属性与推荐规则

[Riot Data Dragon](https://developer.riotgames.com/docs/lol#data-dragon) 提供公开英雄与装备属性。`scripts/sync-static.cjs` 获取与内置 OP.GG 补丁匹配的 `zh_CN/champion.json`、`item.json`；当前 `data/static/riot.json` 是 16.21.1，含 173 个英雄和 863 个物品记录。

Data Dragon 用于职业标签、基础属性、资源类型及装备合成关系，不提供本项目的胜率和排名。推荐指数是可解释的 0–100 规则分：OP.GG 档位为主，叠加已持有装备、已选海克斯联动和小幅职业修正。理由与分项随结果返回，缺少信息时降低置信度。

选人候选仅来自自己的英雄与共享备选池，队伍分析先移除自己的原英雄，再逐个替换候选，避免把候选作为第六人或把队友锁定英雄视为可选项。前排、物理／法术方向与辅助覆盖属于职业规则估计，不是实测伤害占比或阵容胜率。

刷新参考只比较同品质的可靠卡片和足够的英雄专属资料。未知剩余次数时仍可给出低置信度条件参考，明确“若仍有刷新次数”“次数未读取”；未知真实刷新池，因此不计算抽取概率或声称可用刷新次数。自动推断的已选联动可以参与计算，但注明记录可能不完整。

## 本机连接

[Riot League Client API 文档](https://developer.riotgames.com/docs/lol#league-client-api)将其列为未承诺支持的本地服务。国服补丁与权限可能影响兼容。

1. 通过 `LeagueClientUx.exe` / `LeagueClient.exe` 的进程启动信息或指定 `lockfile` 发现本地端口与 token；不遍历磁盘、不读游戏进程内存。
2. 对固定回环地址发起白名单 GET：阶段、队列／游戏标识、选人会话。利用 `localPlayerCellId` 标识自己，同时归一化己方英雄与共享备选池。
3. 对局中使用 [Live Client Data API](https://developer.riotgames.com/docs/lol#game-client-api_live-client-data-api) 的 `activeplayer`、`playerlist`、`gamestats`，获取自己的装备、有限英雄属性和己方英雄。优先通过 `rawChampionName` 对齐英雄。
4. 玩家身份只用于主进程内匹配自己，不进入公开应用状态。认证只存在内存；对自签名证书的例外仅适用于固定回环请求，外部 HTTPS 验证保持开启。

LCU 的选人刷新次数不能当作游戏内海克斯刷新次数。当前没有从这些接口读到可靠的已选海克斯或海克斯刷新次数字段，保留未知，不填假数据。

队列 2400 或队列名称中的 Mayhem／海克斯可确认模式。仅有 Live Client、队列未知且模式包含 ARAM 时，可继续寻找三张完整海克斯卡片作为模式证据；已知普通 ARAM 队列不会直接自动开启海克斯浮层。

## 自动卡片识别和选择推断

链路如下：

1. 隐藏 Win32 辅助进程按进程及窗口句柄识别 LeagueClient 和游戏窗口，观察可见性、前台状态、矩形及自然鼠标按下事件。
2. `desktopCapturer` 取得匹配游戏窗口句柄的缩略图，裁剪配置区域。按最多 1.5 倍缩放，最长边不超过 2200 像素。
3. 使用 [Windows.Media.Ocr.OcrEngine](https://learn.microsoft.com/en-us/uwp/api/windows.media.ocr.ocrengine) 识别中文；不可用时回退 Tesseract 中文模型。原生辅助进程隐藏运行，临时裁剪 PNG 完成后删除。
4. 用 OP.GG 完整名称匹配 OCR 行／词坐标，要求三个不同名称处于合理横向间距与同一高度。两次独立观察得到稳定三选一后才展示标注。
5. 在稳定卡片内部观察到自然点击，随后两次 OCR 确认卡片消失，才添加“自动推断”已选记录。下沿可能含刷新按钮，不作为选卡点击区域；卡片替换、失焦、过期观察不作为选择证据。

每轮 OCR 完成约 1.3 秒后再运行下一轮。观察超过 6 秒没有更新时失效卡片几何和待确认点击，避免对旧画面的鼠标位置作推断。识别过程中不自动点击、不移动鼠标、不抢焦点。

Electron 枚举窗口时可能取得其他窗口缩略图，但只有选中的游戏窗口进入 OCR，其他窗口图像不保存、不上传。识别文字保留于运行内存；本机诊断只记录阶段、窗口状态、卡片／装备 ID 等状态，不包含认证凭据。

本机原生中文 OCR 已通过合成名称图片验证；这不等于已用实际卡片完成校准。截图黑屏、独占全屏、遮挡、游戏字体、UI 缩放和选择速度仍会影响结果。

## 外置浮层与自绘界面

按 [Electron BrowserWindow 文档](https://www.electronjs.org/docs/latest/api/browser-window)创建独立透明、无边框、置顶窗口，使用 `focusable:false`、`skipTaskbar:true`、`setIgnoreMouseEvents(true)` 和 `showInactive()`。控制面板与只读浮层分开，符合 [Electron 鼠标穿透窗口方案](https://www.electronjs.org/docs/latest/tutorial/custom-window-interactions#click-through-windows)。

Win32 物理坐标转换为 Electron DIP 坐标，浮层随窗口位置和大小更新，支持 DPI 与负坐标副屏。选人面板放在客户端侧边；游戏普通状态使用侧边摘要；三卡稳定时显示三个独立标注，优先置于估算卡片上方，空间不足时置于下方。卡片主体来自 OCR 标题网格的估算，因此仍需实局位置验证。

游戏失去前台、最小化或画面失效时隐藏浮层。窗口观察使用普通 Win32 读取，不注入、不安装 Hook、驱动或模拟输入。控制面板使用自绘标题栏、下拉弹层和设置界面；托盘单击和右键均打开面板，不使用系统托盘上下文菜单。

选择 Electron 的理由是透明窗口、网页 UI、网络解析和本地 OCR 可直接组合；代价为包体和内存。Tauri / Rust、.NET / WPF 是可替代的桌面实现，本版不额外引入其他覆盖层平台。

## 验证范围

- 已验证公开 OP.GG 页面解析、缓存回退、来源字段、官方静态数据、只读接口白名单、阵容替换、未知值和联动／刷新规则。
- 已验证合成 OCR 几何、稳定观察、自然点击后的消失推断、刷新替换和过期帧处理。界面测试在隐藏 Electron 窗口中检查自绘控制与浮层，不占用用户鼠标或焦点。
- 已在当前机器实际发现 LeagueClient 窗口，LCU 返回 `EndOfGame` 与队列 `2400`。
- 真实海克斯选人流程、不同分辨率的卡片区域、真实卡片叠加与长时间自动识别仍需用户实局验证，不能由合成测试替代。

`%APPDATA%\Hexthon\runtime-status.json` 可用于后台排查连接、阶段、窗口、卡片与识别状态。`.qa` 测试产物、`.research` 调研临时文件及本机配置不上传仓库，也不进入打包产物。
