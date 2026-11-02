# v0.2.2：无画面采集路线与证据

调研日期：2026-11-02。目标环境：Windows、腾讯国服、现有 Electron 45 项目。本文区分已实现、实际观察和候选方案；[v0.2.1 视觉方案](RESEARCH.md) 是历史记录。

## 当前实现

默认启动采用接口模式。旧版画面采集运行已停止；新模式只创建一个默认隐藏的自绘控制面板，使用 LCU / Live Client Data 自动跟随英雄、己方阵容和装备。每轮读取完成后等待 3 秒再查询，不启动 `desktopCapturer` 取图、OCR、HUD 图标模板匹配、原生窗口观察进程或游戏浮层。视觉实现仅保留在显式开发实验参数 `--visual-experimental` 后，不是失败回退方案。

目前缺少可靠的三选一、完整已选海克斯、剩余刷新次数、商店开关和卡片位置，因此默认模式不显示商店或海克斯浮层。控制面板仍可查询 OP.GG 资料和已知上下文的规则分。本次没有安装 Overwolf、游戏插件或驱动，也没有接入新的外部事件 SDK。

删除画面识别的默认运行路径，能够避免原有截图、缩放、OCR 和图标比较工作；这是一项实现事实，不是 FPS 改善比例。Electron、本地接口请求和客户端发现仍有成本，本轮没有可用于量化流畅度变化的对照帧时间测试。

## Riot 本地接口

Riot 文档区分客户端 LCU 与实际对局中的 Game Client API。Live Client Data 在本机 `https://127.0.0.1:2999` 提供 `activeplayer`、`playerlist`、`playeritems`、`gamestats` 等 JSON，可读取英雄、装备与有限属性，无需屏幕识别。Riot 建议按需读取数据子集；LCU 则属于未承诺支持的本地服务，接口可能变化。[Riot 官方文档](https://developer.riotgames.com/docs/lol)

本项目当前通过白名单 GET 查询 LCU 的阶段、选人会话、队列信息，以及 Live Client 的玩家和对局数据。选人候选是自己的英雄与共享备选池，不把队友已锁定英雄当成可直接替换的候选。OP.GG 负责统计和出装，本地 API 负责当前状态。

本机当前腾讯客户端对局只读检查得到 `gameMode: KIWI`、地图 `12`、`fullRunes: {}`。这组观察说明不能把普通 ARAM 字样作为唯一匹配条件，也不能把空符文对象当成“没有选海克斯”。本次未读到可靠的三选一或商店可见字段；未发现字段不等于证明所有版本永远没有该字段。

### 部分已选海克斯的非视觉信号

参考项目在本机玩家 `summonerSpells` 中读取 `rawDisplayName`，从 `Augment_ARAM_<key>_` 标识提取授予召唤师技能的海克斯键。该信号来自对局 JSON，适用范围仅限暴露此标识的海克斯。[CyberKird 的实际源码](https://github.com/CyberKird/aram-mayhem-helper/blob/master/ingame-app/live_client.py)

本项目已独立实现这一窄范围解析：只检查自己的两个召唤师技能字段，要求标识明确且能唯一映射到 OP.GG 目录；歧义、普通技能、错误结构和未知键不生成记录。解析始终返回 `complete: false`，没有匹配并不代表完整已选列表为空。普通被动海克斯、候选卡片、选卡历史以及刷新次数都不能由它推出。测试样本是合成数据，尚不能称为国服实际选择海克斯后的完整端到端验证。

## 开源项目提供的可采用方向

| 参考 | 实际证据 | 对本项目的意义 |
| --- | --- | --- |
| [CyberKird/aram-mayhem-helper 的 Live Client 代码](https://github.com/CyberKird/aram-mayhem-helper/blob/master/ingame-app/live_client.py) | 获取玩家装备，并提取技能字段中的部分海克斯标识 | 已采用独立实现的局部解析；不能当作完整海克斯 API |
| [Sygnano/aram-mayhem-tracker 的装备页代码](https://github.com/Sygnano/aram-mayhem-tracker/blob/main/apps/desktop/src-tauri/src/engine/itemsets.rs) | 通过 LCU 装备页结构把推荐呈现在游戏原生商店 | 可绕开“先检测商店是否打开，再显示外部窗口”的需求；本项目仅完成数据生成与合并 |
| [zp96-cmd/mayhem-overlay 的数据来源说明](https://github.com/zp96-cmd/mayhem-overlay#data-sources-all-local--community--no-riot-api-key-needed) | 状态走 LCU / Live Client，三选一仍走截图裁剪与 Tesseract | 同类开源产品并非普遍已有无需图像的完整三选一方案 |

上述项目的统计来源不相同。本项目继续使用 OP.GG，不将其他项目的 ARAMKit / aramgg 胜率或数据宣称为 OP.GG 数据。没有复制参考项目的业务源码。

### 原生装备页的准备状态

`src/core/native-itemsets.cjs` 已能将 OP.GG 推荐生成原生装备页 JSON：过滤魄罗佳肴和无效物品，生成稳定的英雄级页面标识，并合并到已有集合。合并保留其他工具、其他英雄和用户自己的页面；输入结构异常时停止准备，不把异常响应当成空集合。

参考项目的当前源码会替换整个集合并删除原推荐文件。本项目未采用这部分行为，当前模块是无磁盘与客户端副作用的纯函数。**尚未接入 LCU 写入，没有安装任何装备页，也未在游戏商店验证呈现结果。** 是否使用原生商店装备页仍待用户选择；生成数据完成不等于已经部署。

该方案主要解决出装资料出现在商店里的问题，不提供海克斯识别，也不证明外部浮层能精确知道商店位置。实际接入还需验证腾讯客户端接口与读回结果。

## Overwolf 事件路线

Overwolf 的 LoL GEP 官方文档明确提供 ARAM Mayhem 的 `augments`（当前可选列表）和 `picked_augment`（最近选中的海克斯），标注自 GEP 299.0 起支持。后者不是完整历史，接入方仍需按局累计、处理重启及缺失事件。[官方 LoL 事件说明](https://dev.overwolf.com/ow-electron/live-game-data-gep/supported-games/league-of-legends/)

官方变更记录的 299.0.7 新增两项 Mayhem 信息，299.0.8 修复两项，307.4.6 再修复 `augments`。这提供了具体、持续维护的候选数据源。[官方变更记录](https://dev.overwolf.com/ow-electron/getting-started/changelog/ow-changelog/)

GEP 可注册所需 features 并接收 `new-info-update`，由应用消费事件，避免自己实现持续截图循环。[GEP API](https://dev.overwolf.com/ow-electron/reference/Overwolf-electron-APIs/gep/Overview/) 但接口采用事件形式不等于底层不用图像；本次查阅没有找到足以证明 LoL 海克斯提取完全不采图或不读内存的官方说明，也未找到明确保证腾讯国服支持的说明。因此不能将它宣传为国服已验证的零截图、零开销方案。

LoL 文档未列出商店开关；`panel_location` 的说明是计分板位置。变更记录中的 `shop_visible` 属于 TFT，不是 LoL 海克斯大乱斗，不能据此承诺商店自动显隐。海克斯候选事件也没有直接证明提供卡片精确位置。[LoL 字段说明](https://dev.overwolf.com/ow-electron/live-game-data-gep/supported-games/league-of-legends/)、[变更记录](https://dev.overwolf.com/ow-electron/getting-started/changelog/ow-changelog/)

接入成本也与普通本地 API 不同：

- OW-Electron 是 Electron 的分支，应用独立运行，不依赖经典 Overwolf Client；同时，现有标准 Electron 45 项目不能假定只添加一个普通 npm 模块即可获得 GEP，需验证其支持版本、包和游戏启用条件。[框架对比](https://dev.overwolf.com/ow-electron/getting-started/onboarding-resources/frameworks-overview/)
- 使用 API 要求应用提案获得白名单；公开发布有 QA 和可信 CA 签名要求，未签名分发版不能加载 GEP 等游戏包。自 2026-11-01 起，官方仅审批使用 Overwolf 广告或 Tebex 商业化的应用。[发布要求](https://dev.overwolf.com/ow-electron/getting-started/release-your-app/)
- 本项目尚未完成上述接入步骤，未安装运行时，也未测量国服事件完整性与对局性能。官方能力说明不替代实际集成验证。

## 后续验证的边界

本轮默认方案优先保留可验证的本地数据读取，缺少实时字段时保持未知。不会把等级触发时机、快捷键、装备变更或空数组解释为已确认的选卡／商店事件。用户未要求恢复视觉方案时，不重新开启画面采集。

在可用事件来源得到确认前，完整无截图海克斯浮层仍未完成。原生装备页可作为出装展示的下一步，但其实际写入与游戏呈现应独立验证，不能与海克斯识别混为一项已实现能力。
