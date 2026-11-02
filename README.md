# Hexthon · 海克斯大乱斗外置助手

面向腾讯国服客户端的 Windows 助手，使用 OP.GG 的英雄排名、海克斯档位与出装资料。**v0.2.2 默认采用无画面采集的接口模式**：后台读取本机 LCU / Live Client Data，自动跟随英雄、队友和装备；不启动截图、OCR、图标匹配或原生窗口监控，也不创建游戏浮层。

目前尚未实现无截图条件下的三选一卡片读取、完整已选海克斯恢复和商店开关检测，因此不会在这些页面自动弹出推荐。控制面板默认隐藏，保留自绘界面供主动查阅。本轮已停止旧版画面采集流程；不会因连接失败自动退回 OCR。公开源码：[Sskift/hexthon](https://github.com/Sskift/hexthon)。

## 启动与使用

当前 v0.2.2 从源码运行：安装依赖后执行 `npm.cmd start`。本轮尚未生成 v0.2.2 安装产物；执行 `npm.cmd run package` 完成打包后，才会生成 `dist/0.2.2/Hexthon-win32-x64/Hexthon.exe`，使用时需保留整个文件夹。

1. 正常启动后驻留托盘，只创建一个默认隐藏的控制面板。不会自动显示右上角助手、商店旁浮层或海克斯卡片标注。
2. 后台自动连接客户端；每轮读取完成后等待 3 秒再进行下一轮本地接口查询，避免轮询堆积。选人阶段读取自己的英雄、己方阵容和共享备选池；对局阶段读取自己的装备、有限英雄属性，以及接口提供的双方实际购入装备。
3. 需要查阅时，点击或右键点击托盘 H 图标，或按 `Ctrl + Alt + H` 显示面板。显示使用 `showInactive()`，程序不主动激活游戏或发送系统输入。面板使用自绘标题栏和设置界面，托盘右键不弹出 Windows 原生菜单。
4. 面板跟随当前英雄更新 OP.GG 资料；可查看英雄排名、出装、海克斯规则分和阵容候选。暂时没有可靠数据的字段保持未知。手动查阅和校正属于可选功能，不能替代尚未完成的全自动三选一识别。

旧版的扫描与浮层快捷键不能在默认接口模式中开启画面采集。游戏显示模式不再是默认数据读取的截图前提；本地接口能否连接仍受客户端版本和权限影响。

## 数据与能力边界

| 信息 | v0.2.2 默认行为与来源 |
| --- | --- |
| 英雄排名、T0–T5 档位、海克斯与出装资料 | OP.GG 海克斯大乱斗公开页面，保留来源、补丁和获取时间 |
| 当前英雄、队伍和共享备选池 | 本机 LCU；候选仅比较自己的英雄与共享备选池 |
| 当前装备、英雄属性 | 本机 Live Client Data；未读到时保持未知。魄罗佳肴（2052、220013）不计入装备及装备联动 |
| 对局出装适配 | 依据当前英雄和实际装备方向，根据对手购入的护甲、魔抗、吸血装备给出穿透或重伤规则建议；队友已有重伤装备时降低补购优先级。优先使用 OP.GG 路线候选，Riot 静态装备资料补充项单独标明 |
| 部分已选海克斯 | 从本机玩家召唤师技能的 `rawDisplayName` 中匹配明确的 `Augment_ARAM_<key>_` 标识，再与 OP.GG 唯一键对应并加入已知记录；仅覆盖暴露这种字段的技能类海克斯 |
| 完整已选海克斯 | 尚不可得。部分技能解析结果始终标为 `complete: false`；空结果不表示本局没有海克斯 |
| 当前三选一、海克斯刷新次数 | 默认模式尚无可靠来源，不生成实时三选一或刷新结论 |
| 商店打开状态、海克斯面板位置 | 默认模式尚无可靠来源，不自动显示浮层 |
| 推荐指数 | OP.GG 档位结合装备、已知海克斯和职业适配的 0–100 规则分，**不是胜率**；已选信息不完整会影响联动判断 |

阵容建议使用英雄职业标签估计前排、物理／法术输出方向和辅助覆盖，不能解读为实际伤害比例、克制统计或队伍胜率。当前 OP.GG 页面没有核实到可直接采用的实际胜率字段，界面显示“未公开”；`performance`、`popular` 不会改写为胜率、选取率或样本量。OP.GG 页面统计未声明为国服统计。

对局装备建议目前依据英雄和装备，是有条件的规则判断：已购装备属性不等于对手总护甲／魔抗，持有重伤装备不保证实际命中覆盖。队友装备未读全时不推断队伍缺少重伤，已拥有的同类装备或合成后的成品会避免重复推荐；不估计隐藏属性、治疗量、实际伤害占比或胜率。部分技能海克斯可以进入已知记录，但完整海克斯之间的联动目前不可用。

随包资料为 16.21 页面快照：173 个英雄、263 个完整通用海克斯，以及阿狸的 209 个专属海克斯和出装。其他英雄按需获取并缓存，缓存有效期 6 小时，失败保留最近成功资料。Riot Data Dragon 16.21.1 提供英雄职业和装备基础属性，不提供本项目的表现排名。

已准备原生装备页的数据生成与合并模块：使用 OP.GG 推荐，过滤魄罗佳肴，按稳定标识更新 Hexthon 自己的页面并保留其他装备页。**目前只准备数据，尚未接入客户端写入，也没有安装或改写任何装备页**；是否采用游戏内原生装备页仍待用户选择。这一方案可由游戏自身在商店里展示出装，具体呈现仍需接入后验证。

## 无截图方案与验证范围

本机只读检查已在当前腾讯客户端对局中看到 `gameMode: KIWI`、地图 `12`，以及空的 `fullRunes`。这些是本次实测值，不构成所有国服版本的固定协议。空 `fullRunes` 不能用于推断完整海克斯；召唤师技能中的局部标识也不能读取候选卡片或普通被动海克斯。

已调研开源项目的 Live Client 技能字段、客户端原生装备页和 Overwolf GEP。Overwolf 官方提供 ARAM Mayhem 的候选／最近选择海克斯事件，但腾讯国服兼容、底层采集方式与实际性能仍未验证，且接入涉及其 Electron 分支、白名单和发布要求；本项目没有安装或接入 Overwolf。完整证据和限制见 [v0.2.2 无画面采集调研](docs/NO_CAPTURE_RESEARCH.md)。

原视觉代码保留在开发实验入口 `--visual-experimental` 后，普通启动、已有设置和自动重连均不会启用它。它不是本版默认方案，也没有获得新的实际对局性能保证。旧 [v0.2.1 调研](docs/RESEARCH.md) 仅记录历史视觉方案，不代表当前默认行为。

程序不读取隐藏敌方信息、不读游戏进程内存、不注入、不安装驱动，也不自动选卡、换英雄或购买装备。默认本地接口仅使用固定白名单的回环 GET 请求；认证信息只留在主进程内存，不传给界面、不写入诊断。外部 HTTPS 仍验证证书。客户端发现和 API 查询仍有运行成本，当前不声称对帧率“零影响”；需要在真实对局中测量才能量化变化。

## 开发与诊断

要求：Windows 10/11 x64，Node.js 22.12+。

```powershell
npm.cmd ci
npm.cmd start                           # 默认接口模式，后台托盘启动
npm.cmd run start:panel                 # 主动显示自绘控制面板
npm.cmd test                            # 数据、连接、规则与纯逻辑测试
npm.cmd run test:api                    # 无截图的隐藏窗口 DOM 检查
npm.cmd run sync                        # 更新 OP.GG 内置快照
node scripts/sync-static.cjs            # 更新匹配补丁的 Riot 静态属性
node scripts/cache-assets.cjs           # 更新内置图标缓存
npm.cmd run package                     # 输出 dist/<版本>/Hexthon-win32-x64
```

设置、缓存和诊断文件在 `%APPDATA%\Hexthon`。`runtime-status.json` 记录阶段、连接、识别模式、采集开关、窗口数与装备 ID，不包含 LCU 凭据。默认模式应看到 `recognitionMode: api`、`captureEnabled: false`、`windowMonitorEnabled: false`、`windowCount: 1`。如果不能自动连接，可以在设置中填写实际 `lockfile` 文件或所在目录。

`test:api` 使用独立 `.qa/profile`，保持测试窗口隐藏，通过 DOM 与应用状态检查默认模式，报告写入 `.qa/api-smoke.json`；测试不截图、不移动鼠标或发送系统键盘输入。纯解析与装备规则测试使用合成样本，不代表已经在国服实局读到对应技能海克斯或验证了出装收益。`.qa`、`.research`、本机配置、缓存模型及打包输出不进入源码仓库；测试目录和诊断产物不进入安装包。

| 代码位置 | 内容 |
| --- | --- |
| `src/controller.cjs` | 生命周期、接口模式、托盘、状态协调及 IPC |
| `src/core/opgg.cjs` | OP.GG 页面归一化、缓存与退避 |
| `src/core/league.cjs` | 国服发现、LCU 和 Live Client 只读信息 |
| `src/core/api-augments.cjs` | 技能字段中的部分海克斯解析 |
| `src/core/native-itemsets.cjs` | 原生装备页的纯数据生成与保留其他页面的合并 |
| `src/core/recommendations.cjs` | 海克斯指数、阵容候选、出装、`matchupRecommendations` 对局装备适配及条件刷新参考 |
| `scripts/run-api-smoke.cjs`、`scripts/api-smoke.cjs` | 无截图的接口模式 DOM 与状态检查 |
| `src/renderer` | 自绘控制面板及保留的实验浮层界面 |
| `data/seed`、`data/static` | OP.GG 快照与 Riot 描述性属性 |
| `docs/NO_CAPTURE_RESEARCH.md` | 当前无截图路线、参考源码与未解决能力 |

## 来源

资料来自 [OP.GG 海克斯大乱斗](https://op.gg/zh-cn/lol/modes/aram-mayhem)，描述性属性来自 [Riot Data Dragon](https://developer.riotgames.com/docs/lol#data-dragon)。公开页面解析不是 OP.GG 承诺稳定的开放 API。游戏资料、图片及依赖保留各自权利与许可，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

Hexthon isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.
