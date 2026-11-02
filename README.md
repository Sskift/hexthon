# Hexthon · 海克斯大乱斗外置助手

面向腾讯国服客户端的 Windows 外置助手。**v0.2.1 只在商店或海克斯选择页面出现时显示推荐**，平时不显示右上角常驻助手。程序自动跟随英雄，使用 OP.GG 的英雄排名、符文档位与出装资料，结合本机可见对局信息给出参考。

公开源码：[Sskift/hexthon](https://github.com/Sskift/hexthon)。目前是可运行的测试版本；已在本机发现 LeagueClient 窗口，并实际读取到 LCU 的 `EndOfGame` 阶段和海克斯队列 `2400`。真实对局的三张卡片位置与识别效果仍待实测校准。

## 启动与使用

本地打包目录：`dist/0.2.1/Hexthon-win32-x64/`，运行其中的 `Hexthon.exe`。请保留整个文件夹。

1. 启动后驻留托盘，打开英雄联盟并进入海克斯大乱斗即可。自动跟随、自动浮层和自动识别默认开启。
2. 游戏使用**无边框**或**窗口模式**。打开商店后，识别到商店标签与购买控件，在商店旁的可用空间显示紧凑出装推荐；关闭商店后收起。商店边界由文字位置估算，真实界面仍需校准。
3. 游戏出现三选一卡片时，连续两次识别到三个完整名称及对应布局后，在卡片附近显示三个推荐标注；没有卡片和商店时不显示游戏浮层。选人阶段也不显示侧边助手，英雄排名和队友阵容分析保留在控制面板中。
4. 提示位置跟随游戏窗口与识别区域。切出游戏或最小化后自动隐藏；返回前台后重新检查当前页面。浮层鼠标穿透，不接收键盘焦点。
5. 点击或右键点击托盘 H 图标打开控制面板。面板使用自绘标题栏、下拉弹层和设置页面；托盘右键不弹出 Windows 原生菜单。面板右上角可隐藏、最小化或退出程序。

| 快捷键 | 功能 |
| --- | --- |
| Ctrl + Alt + H | 显示控制面板，不主动激活窗口 |
| Ctrl + Alt + O | 暂停／恢复商店与海克斯页面提示，不强制显示常驻浮层 |
| Ctrl + Alt + S | 立即尝试识别当前游戏卡片 |

快捷键是补充操作，正常自动识别无需按键。面板可以手动查阅英雄、校正已选记录；恢复自动跟随后继续随本机英雄更新。

## 推荐信息如何产生

| 信息 | 来源与含义 |
| --- | --- |
| 英雄综合排名、T0–T5 档位、符文与出装 | OP.GG 海克斯大乱斗公开页面，保留来源、补丁和获取时间 |
| 当前英雄、队伍和共享备选池 | 本机 LCU；只比较自己的英雄和共享备选池，不把队友的已锁英雄当成可直接换取的选项 |
| 当前装备、英雄属性 | 本机 Live Client Data API；未读到时保持未知。魄罗佳肴（2052、220013）不计入装备与装备联动 |
| 当前三张卡片 | 游戏窗口局部截图，本地中文 OCR 与 OP.GG 名称词典匹配 |
| 已选海克斯 | HUD 图标与本地图标模板连续两帧匹配后记录为“图标识别”，不依赖固定位置点击；属于视觉证据，不是 API 确认。卡片点击后消失仍可作为辅助推断 |
| 推荐指数 | OP.GG 档位加装备联动、已选联动与职业适配规则，范围 0–100，**不是胜率** |
| 刷新参考 | 同品质选项对比。次数未读取时给出“若仍有刷新次数”的条件参考，不声称一定能刷新，也不估计抽取概率 |

阵容建议使用英雄职业标签估计前排、物理／法术输出方向和辅助覆盖，不是实际伤害比例、克制统计或队伍胜率。图标识别和自动推断的已选记录都可能不完整，参与联动时会说明其不确定性，可在控制面板校正。

当前 OP.GG 页面没有核实到可直接采用的实际胜率字段，界面显示“未公开”。内部 `performance`、`popular` 不会改写为胜率、选取率或样本量。OP.GG 页面统计未声明为国服统计。

随包资料为 16.21 页面快照：173 个英雄、263 个完整通用符文，以及阿狸的 209 个专属符文和出装。其他英雄按需获取并缓存，缓存有效期 6 小时，失败保留最近成功资料。Riot Data Dragon 16.21.1 提供英雄职业和装备基础属性，不提供本项目的表现排名。

## 自动识别与连接边界

- 后台 Win32 辅助进程读取窗口矩形、前台状态和鼠标按下状态；不移动鼠标、不发送输入、不激活游戏窗口。
- 通过进程与窗口句柄定位 LeagueClient／游戏窗口；物理坐标转换为 Electron DIP 坐标，支持不同 DPI 和负坐标副屏。
- OCR 逐轮运行，不并发堆积识别任务。裁剪区域最多放大 1.5 倍，最长边不超过 2200 像素。
- 优先使用 Windows 中文 OCR，失败时使用 Tesseract 中文模型。首次备用识别可能需要下载模型。截图在本地处理，临时裁剪图片完成后删除。
- 三张卡片需要完整名称、横向几何匹配及两次独立稳定观察；模糊匹配不会直接变成卡片标注。超过 6 秒没有新观察时清除旧卡片几何与待确认点击。
- 商店需要同时识别到同排导航标签和下方购买控件；连续两次确认后显示，识别到商店消失、失焦或观察过期后隐藏。单个物品提示或聊天中的“购买”文字不会单独触发。
- 已选海克斯可从本机游戏 HUD 图标自动恢复；模板匹配与连续帧校验只能提供视觉识别证据，图标遮挡、分辨率和主题差异可能导致漏读。
- LCU 与 Live Client 是不同连接。Live Client 仅在实际对局中可用；国服补丁、权限和显示模式会影响兼容性。
- 队列 2400 或名称中的 Mayhem／海克斯可确认模式。只有 Live Client、队列未知时，允许在 ARAM 画面寻找三张可靠海克斯卡片作为模式证据；普通 ARAM 不直接等同于海克斯模式。

没有自动连接时，可在设置中填写实际 `lockfile` 文件或所在目录。识别不到卡片时，先确认游戏处于前台、采用无边框模式，再检查识别区域设置。独占全屏、黑屏、遮挡、字体与 UI 缩放仍可能影响截图和布局识别。

程序不读取隐藏敌方信息，不读取游戏进程内存，不注入、不安装驱动，也不自动选卡、换英雄或购买装备。本地 API 仅使用固定白名单的回环 GET 请求；认证信息只留在主进程内存，不传给界面、不写入诊断。外部 HTTPS 仍验证证书。

## 开发与诊断

要求：Windows 10/11 x64，Node.js 22.12+。

```powershell
npm.cmd ci
npm.cmd start                        # 后台托盘启动
npm.cmd run start:panel              # 显示自绘控制面板
npm.cmd test                        # 数据、状态、识别与推荐逻辑测试
npm.cmd run test:ui                  # 隐藏窗口的 Electron 界面测试
npm.cmd run test:ui -- --with-ocr     # 加测本地中文 OCR
npm.cmd run sync                     # 更新 OP.GG 内置快照
node scripts/sync-static.cjs         # 更新匹配补丁的 Riot 静态属性
node scripts/cache-assets.cjs       # 更新内置图标缓存
npm.cmd run package                 # 输出 dist/<版本>/Hexthon-win32-x64
```

设置、缓存和本机诊断文件在 `%APPDATA%\Hexthon`。`runtime-status.json` 记录阶段、窗口、卡片与装备 ID、连接和 OCR 状态，不包含 LCU 凭据。可用它在后台排查自动识别，无需抢占窗口焦点。

界面测试使用独立 `.qa/profile`；截图和报告留在 `.qa`，测试窗口保持隐藏，不移动鼠标或发送系统键盘输入。`.qa`、`.research`、缓存模型和打包输出不进入源码仓库；测试目录与诊断产物不进入安装包。打包按版本分目录，默认不覆盖已有输出。

| 代码位置 | 内容 |
| --- | --- |
| `src/controller.cjs` | 生命周期、托盘、自动状态协调、浮层和 IPC |
| `src/core/opgg.cjs` | OP.GG 页面归一化、缓存与退避 |
| `src/core/league.cjs` | 国服发现、LCU 和 Live Client 只读信息 |
| `src/core/window-monitor.cjs`、`src/native/window-monitor.ps1` | 被动窗口与点击状态观察 |
| `src/core/ocr.cjs`、`src/core/vision.cjs` | 本地 OCR、卡片定位和选择推断 |
| `src/core/shop-vision.cjs` | 商店文字与区域识别、稳定观察与关闭检测 |
| `src/core/recommendations.cjs` | 符文指数、阵容候选、出装及刷新参考 |
| `src/core/overlay-layout.cjs`、`src/renderer` | 相对窗口布局与自绘界面 |
| `data/seed`、`data/static` | OP.GG 快照与 Riot 描述性属性 |
| `docs/RESEARCH.md` | 参考项目、信息获取途径与验证范围 |

隐藏窗口、合成文字和逻辑测试已经覆盖对应实现，但不能替代真实对局中的商店、三卡与 HUD 图标识别和叠加验证。

## 来源

资料来自 [OP.GG 海克斯大乱斗](https://op.gg/zh-cn/lol/modes/aram-mayhem)，描述性属性来自 [Riot Data Dragon](https://developer.riotgames.com/docs/lol#data-dragon)。公开页面解析不是 OP.GG 承诺稳定的开放 API。游戏资料、图片及依赖保留各自权利与许可，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

Hexthon isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.
