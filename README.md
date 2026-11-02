# Hexthon · 海克斯大乱斗外置助手

面向腾讯国服客户端的 Windows 助手，使用 OP.GG 的英雄排名、海克斯档位与出装资料。**v0.4.0（2026-11-03）保留两种启动方式：`npm start` 为无画面采集的接口模式；`npm run start:assist` 使用小区域识别与按场景出现的自绘浮层，并记住上次的暂停状态。** 本版加入可撤回的原生商店装备方案、补丁兼容提示、扫描退避和诊断导出，详见 [0.4.0 发布与验证记录](docs/RELEASE_0.4.0.md)。

接口模式后台读取本机 LCU / Live Client Data，自动跟随英雄、队友和装备；不启动截图、OCR、图标匹配或原生窗口监控，也不创建游戏浮层。助手模式已经接入三卡识别、商店检测、部分 HUD 恢复和选人提示，但仍需要国服实局验证。两个模式都支持按可靠局 ID 保存部分已选记录；完整已选始终标为未知。公开源码：[Sskift/hexthon](https://github.com/Sskift/hexthon)。

## 启动与使用

从源码运行：先执行 `npm.cmd ci`，再选择下面的启动命令。本版已在本地构建 `dist/0.4.0/Hexthon-win32-x64/Hexthon.exe` 并通过包内容／SHA-256 清单检查，完整目录约 421 MiB；运行打包版本时需保留整个文件夹。自定义可执行文件尚未运行验证，Windows CI 尚待远端执行，详见 [本版验证记录](docs/RELEASE_0.4.0.md)。校验清单不等于代码签名。

1. **`npm.cmd start`：接口模式。** 驻留托盘，只创建一个默认隐藏的面板。不会因已有设置或接口连接失败自动启用采集。
2. **`npm.cmd run start:assist`：助手模式，等同 `electron . --assist`。** 游戏窗口处于前台时，按需采集该窗口的指定小区域。强化选项可靠识别后在卡片附近显示推荐；商店经过独立文字证据与连续两次新鲜采样确认后显示出装提示，关闭或证据失效就隐藏。没有常驻右上角助手。
3. 选人阶段自动跟随自己的英雄、队友和共享备选池。助手模式仅在确认海克斯模式、客户端处于前台且客户端旁有足够桌面空位时显示选人提示；没有空位时保持隐藏，资料仍在面板中。
4. 需要查阅或校正时，点击或右键点击托盘 H 图标，或按 `Ctrl + Alt + H` 显示面板。面板和浮层采用自绘界面，使用不激活窗口的显示方式，不移动鼠标、发送系统输入或代替玩家操作。助手模式可用 `Ctrl + Alt + O` 同时暂停／恢复小区域识别和场景提示；暂停时清空过期检测。接口模式不注册该快捷键。
5. 对局数据逐轮查询，完成后再安排下一轮，避免堆积；接口模式间隔 3 秒，助手模式间隔 1.8 秒。未读取到的装备、强化、胜率等保持未知。按局记录可手动校正和撤销，不把手动填写视为完整自动识别。
6. 原生装备方案默认关闭。在自绘设置页可**导入当前查阅英雄的方案**，或开启自动同步：仅在实际海克斯选人／对局、英雄与资料匹配时更新，间隔至少 30 秒。可用“撤回”恢复助手管理的页面；发现用户或其他工具修改了同一页时停止覆盖。读回成功不代表原生商店已在本局热刷新。

暂停会同时停止窗口监控、拒绝手动采集并销毁场景浮层，本机接口继续更新，暂停状态跨重启和接口模式保存。原生装备方案有独立开关。`npm.cmd run start:paused` 明确以暂停状态启动；恢复使用面板或 `Ctrl + Alt + O`。`npm.cmd run stop` 正常退出并在约 4 秒总预算内等待记录保存；失败保留诊断与最近完整记录。重复后台启动不会弹出面板；已有实例不会因第二次传入 `--assist` 而自动切换模式，需要先退出再按目标模式启动。

浮层只在对应场景需要时创建，暂停或换局释放。新增的启动、退出、异常保存、原生辅助进程与资源预检见 [v0.3.1 验证记录](docs/PREFLIGHT_0.3.1.md)。这不替代真实对局识别率和帧率验收。

旧版的扫描与浮层快捷键不能在默认接口模式中开启画面采集。本地接口能否连接仍受客户端版本和权限影响；助手模式的国服显示模式、缩放和采集兼容性需实际验证。

## 当前开发路线

主线为 **LCU / Live Client + 小区域图形检测 + 常驻 Windows OCR + 自绘浮层**，Overwolf 是独立实验，不是运行前提。已移植 MIT 项目 Sygnano 的按钮模板、布局和变化检测思路，保留许可证。`--assist` 使用轻量管线；旧的 `--visual-light-experimental` 名称仍兼容。只针对已确认的英雄联盟 HWND 采集客户区小区域，不生成所有窗口的缩略图。常驻 OCR 使用内存 BGRA，不反复启动 PowerShell 或落盘 PNG。

当前已接入以下路径，完成标准与实测边界分开记录：

- **强化卡片**：先检查刷新按钮条带，存在候选图形才采集标题条。只对未识别标题做有限局部重读，必须精确匹配三个不同名称并取得两次独立采样后才显示。缓存保留原采样身份；窗口变化或画面过期使旧结果失效。
- **商店**：优先检查合并后的顶部标题区域，再寻找独立底部控件文字；连续两次新鲜识别通过后才显示。根据空位使用约 190–300 宽的侧栏或 96 高的横条，没有合适空位就隐藏。默认商店键只提供加快检查的提示，按键本身不证明商店已打开。
- **部分已选恢复**：底部 HUD 小区域在后台匹配线程中处理，两次稳定图标识别才加入记录。通常每 20 秒安排一组复核；选择、等级或窗口上下文变化可提前触发。验证槽位布局后才能处理槽位替换，共用图标和遮挡保持未知。
- **按局保存**：只在可靠局 ID 与英雄一致时恢复；不同局清空，无法确定局 ID 时不跨重启套用。保存证据等级、槽位和时间，支持手动校正与撤销。识别空结果不清空已有记录，`complete` 始终为 `false`。
- **运行负担与兼容检查**：相同推荐上下文复用结果，扫描过慢或连续失败时延长间隔。已知游戏／资料补丁不匹配会显示提示并暂停原生装备方案同步；静态装备属性与游戏补丁不匹配时暂停对应属性推理。缺少版本信息仍显示未知，不视为已匹配。

**当前仍未取得国服多局识别与游戏帧率结论。** `npm test` 的 292 项测试及 API、light、lifecycle 检查通过；`test:light` 使用合成数据和隐藏窗口，覆盖三卡出现→选择推断→商店出现→关闭／换局清理。正式 ROI 与 FPS 探针均因没有前台游戏返回 `NO_FOREGROUND_LEAGUE`，没有游戏像素或帧样本。PresentMon 的独立 ETW 启停和清理检查成功，但无渲染隔离进程正确返回零帧，不是游戏 FPS 成绩。详见 [帧时间验收](docs/FRAME_TIME_VALIDATION.md)。

同一张既有 1920×1080 合成图片的 OCR 离线测试：旧单次进程耗时 332–394 ms；新常驻 worker 热轮 21–33 ms，含裁剪缩放的 `OcrReader` 热轮 27–40 ms；首轮仍约 400 ms。此结果不包含实际游戏采集，不是 FPS 改善比例。详细瓶颈和上游实现见 [OCR 性能记录](docs/OCR_PERFORMANCE.md)，产品缺口和竞品依据见 [产品差距](docs/PRODUCT_GAPS.md)。

`npm.cmd run test:catalog` 对通用目录生成离屏中文标题，在三种分辨率运行真实 Windows OCR，不抓屏。当前完整三卡 **184/264**，正确标题 **686/792**，这批合成样本误认 **0**；1280×720 的完整三卡仅 **39/88**，仍有明显缺口。相同规范化名称和纯标点名称会主动拒绝匹配。此报告不代表实局准确率，不能据此称为全面解决中文识别。较小的链路检查仍可通过 `node scripts/check-light-offline.cjs` 复现。

Overwolf 44.9.0 官方运行时已做独立后台试验：运行时能启动，缺开发凭据时未加载 GEP，尚未进入国服事件验证。英文／中文海克斯映射与事件解析已准备，见 [实验结果与复现](docs/OVERWOLF_EXPERIMENT.md)。

## 数据与能力边界

| 信息 | v0.4.0 行为与来源 |
| --- | --- |
| 英雄排名、T0–T5 档位、海克斯与出装资料 | OP.GG 海克斯大乱斗公开页面，保留来源、补丁和获取时间 |
| 当前英雄、队伍和共享备选池 | 本机 LCU；候选仅比较自己的英雄与共享备选池 |
| 当前装备、英雄属性 | 本机 Live Client Data；未读到时保持未知。魄罗佳肴（2052、220013）不计入装备及装备联动 |
| 对局出装适配 | 依据当前英雄、双方公开装备与已知强化给出有限规则建议，包括穿透、重伤、部分装备前置及强化联动；任务奖励不直接作为购买目标，已核实限制会影响候选。优先使用 OP.GG 路线，Riot 静态资料补充项单独标明 |
| 部分已选海克斯 | 从本机玩家召唤师技能的 `rawDisplayName` 中匹配明确的 `Augment_ARAM_<key>_` 标识，再与 OP.GG 唯一键对应并加入已知记录；仅覆盖暴露这种字段的技能类海克斯 |
| HUD 与按局已选记录 | 助手模式新增局部图标匹配、稳定槽位替换；两个模式均可保存和恢复与可靠局 ID 对应的部分记录，并手动撤销校正 |
| 完整已选／敌方海克斯 | 尚无可靠完整来源，记录始终为 `complete: false`；空结果不表示本局没有海克斯，也不推测敌方海克斯 |
| 当前三选一 | 接口模式无可靠来源；助手模式通过按钮图形和完整标题识别，需两次新鲜画面确认 |
| 海克斯刷新次数 | 尚无可靠来源；刷新建议仅在仍有次数的前提下，比较已知同品质档位与规则分，不是实际刷新收益概率 |
| 商店状态、浮层位置 | 接口模式无自动浮层；助手模式依据独立文字区域和窗口几何定位，无法确认或无空位时隐藏 |
| 原生商店装备方案 | 可选手动导入／自动更新，经当前身份校验、备份、冲突检测和读回；腾讯客户端已验证导入与撤回，局内热更新未验证 |
| 推荐指数 | OP.GG 档位结合装备、已知海克斯和职业适配的 0–100 规则分，**不是胜率**；已选信息不完整会影响联动判断 |

阵容建议使用英雄职业与基础普攻射程资料估计前排、物理／法术输出方向、辅助和射程覆盖，只比较当前英雄与可用共享池，不能解读为实际伤害比例、技能射程、克制统计、最优五人阵容或队伍胜率。当前 OP.GG 页面没有核实到可直接采用的实际胜率字段，界面显示“未公开”；`performance`、`popular` 不会改写为胜率、选取率或样本量。OP.GG 页面统计未声明为国服统计。

对局装备建议是有条件的规则判断：已购装备属性不等于对手总护甲／魔抗，持有重伤装备不保证实际命中覆盖。队友装备未读全时不推断队伍缺少重伤，已拥有的同类装备或合成后的成品会避免重复推荐。本版补充属性转换后的原属性收益保护、终极技能禁用与依赖冲突，并保留任务前置、奖励和互斥规则；不推算未读取的转换量、多个转换的结算顺序或完整组合收益。视觉或点击推断记录对应的建议保留条件提示。不估计隐藏属性、治疗量、实际伤害占比或胜率。

随包资料为 16.21 页面快照：173 个英雄、263 个完整通用海克斯，以及阿狸的 209 个专属海克斯和出装。其他英雄按需获取并缓存，缓存有效期 6 小时，失败保留最近成功资料。Riot Data Dragon 16.21.1 提供英雄职业和装备基础属性，不提供本项目的表现排名。

原生装备页已接入生产路径：使用 OP.GG 路线及明确标注的本局规则建议，过滤魄罗佳肴，按稳定英雄标识维护 Hexthon 页面。实际腾讯客户端已完成**导入→读回→撤回，方案数 0→1→0**，测试页已撤回。写前保存目标页回滚记录、重新读取集合及身份；撤回只处理仍匹配助手记录的页面，保留其他页面与用户的新修改。LCU 使用整个集合的 PUT，没有已验证的原子比较更新事务，短暂读写间隙仍可能存在竞争；局内热刷新也尚未验证。外置商店浮层与原生方案是独立能力。

## 无截图方案与验证范围

本机只读检查已在当前腾讯客户端对局中看到 `gameMode: KIWI`、地图 `12`，以及空的 `fullRunes`。这些是本次实测值，不构成所有国服版本的固定协议。空 `fullRunes` 不能用于推断完整海克斯；召唤师技能中的局部标识也不能读取候选卡片或普通被动海克斯。

已调研开源项目的 Live Client 技能字段、客户端原生装备页和 Overwolf GEP。Overwolf 官方提供 ARAM Mayhem 的候选／最近选择海克斯事件，但腾讯国服兼容、底层采集方式与实际性能仍未验证，且接入涉及其 Electron 分支、开发凭据和发布要求。本轮仅在独立实验目录安装并运行官方探针，默认应用未接入；实测结果见 [Overwolf 实验](docs/OVERWOLF_EXPERIMENT.md)，先前调研见 [v0.2.2 无画面采集调研](docs/NO_CAPTURE_RESEARCH.md)。

原视觉代码保留在开发实验入口 `--visual-experimental` 后，普通启动、已有设置和自动重连均不会启用它。它不是本版默认方案，也没有获得新的实际对局性能保证。旧 [v0.2.1 调研](docs/RESEARCH.md) 仅记录历史视觉方案，不代表当前默认行为。

程序不读取隐藏敌方信息、不读游戏进程内存、不注入、不安装驱动，也不自动选卡、换英雄或购买装备。默认本地接口使用固定白名单的回环 GET 请求；**显式导入或启用原生方案自动同步后，会对已核验当前身份的装备方案端点执行窄范围 PUT**。认证信息只留在主进程内存，不传给界面、不写入诊断。外部 HTTPS 仍验证证书。客户端发现和 API 查询仍有运行成本，当前不声称对帧率“零影响”；需要在真实对局中测量才能量化变化。

## 开发与诊断

要求：Windows 10/11 x64，Node.js 22.12+。

```powershell
npm.cmd ci
npm.cmd start                           # 默认接口模式，后台托盘启动
npm.cmd run start:assist                # 小区域识别、场景浮层与部分 HUD 恢复
npm.cmd run start:paused                # 暂停识别启动，保留本机接口更新
npm.cmd run stop                        # 后台正常退出，刷新待保存记录
npm.cmd run start:panel                 # 主动显示自绘控制面板
npm.cmd test                            # 数据、连接、规则与纯逻辑测试
npm.cmd run test:api                    # 无截图的隐藏窗口 DOM 检查
npm.cmd run test:light                  # 合成卡片/商店与隐藏窗口的完整流程检查
npm.cmd run test:lifecycle              # 跨进程恢复、暂停、异常退出与资源检查
npm.cmd run test:native                 # 原生 helper 的无截图协议与退出检查
npm.cmd run test:catalog                # 通用目录的合成标题覆盖率，不抓屏
npm.cmd run probe:itemsets              # 只读检查当前客户端装备方案接口
npm.cmd run prepare:fps                 # 准备并校验官方便携 PresentMon
npm.cmd run probe:fps                   # 受限前台游戏帧时间探针，不切换窗口
npm.cmd run sync                        # 更新 OP.GG 内置快照
node scripts/sync-static.cjs            # 更新匹配补丁的 Riot 静态属性
node scripts/cache-assets.cjs           # 更新内置图标缓存
npm.cmd run package                     # 输出 dist/<版本>/Hexthon-win32-x64
npm.cmd run verify:package              # 检查包内容并生成 SHA-256 清单
```

设置、缓存和诊断文件在 `%APPDATA%\Hexthon`。`runtime-status.json` 记录阶段、连接、识别模式、采集开关、窗口数与装备 ID，不包含 LCU 凭据。默认模式应看到 `recognitionMode: api`、`captureEnabled: false`、`windowMonitorEnabled: false`、`windowCount: 1`。如果不能自动连接，可以在设置中填写实际 `lockfile` 文件或所在目录。

助手模式的诊断为 `recognitionMode: visual-light`、`captureEnabled: true`、`windowMonitorEnabled: true`；这些字段表示功能已启用，不代表当前已经识别成功。`selection-history.json` 只存可靠局 ID、英雄／强化 ID、证据等级、槽位和时间，不包含玩家账号或凭据。

自绘面板提供“导出诊断”，保存到用户配置目录下的 `diagnostics` 文件夹。导出内容为兼容状态、计数、场景和有界耗时汇总，不包含画面、OCR 文本、账号标识、凭据或进程命令行。`native-itemsets.json` 保存目标 Hexthon 页及加盐身份摘要以支持跨重启撤回，不保存原始账号、PUUID、认证信息或其他装备页全集。

`test:api` 使用独立 `.qa/profile`，保持测试窗口隐藏，通过 DOM 与应用状态检查默认模式，报告写入 `.qa/api-smoke.json`。`test:light` 使用合成像素、替代的采集接口和隐藏窗口验证实际状态流程，报告写入 `.qa/light-smoke.json`；这些测试不抓取当前桌面、不移动鼠标或发送系统键盘输入。纯解析与装备规则测试不代表国服实局识别率或出装收益。`.qa`、`.research`、本机配置、缓存模型及打包输出不进入源码仓库；测试目录和诊断产物不进入安装包。

| 代码位置 | 内容 |
| --- | --- |
| `src/controller.cjs` | 生命周期、接口模式、托盘、状态协调及 IPC |
| `src/core/opgg.cjs` | OP.GG 页面归一化、缓存与退避 |
| `src/core/league.cjs` | 国服发现、LCU / Live Client 信息及受限装备方案客户端入口 |
| `src/core/api-augments.cjs` | 技能字段中的部分海克斯解析 |
| `src/core/selection-history.cjs` | 按局部分记录、证据合并、槽位替换、手动撤销与原子存储 |
| `src/core/window-capture.cjs`、`src/native/window-capture.ps1` | 仅指定前台游戏客户区的 ROI 采集 |
| `src/core/title-reader.cjs`、`src/core/light-offer.cjs` | 有限标题重读与三卡精确匹配 |
| `src/core/shop-scanner.cjs`、`src/core/light-shop.cjs` | 商店独立条带证据与采样预算 |
| `src/core/augment-icon-worker.cjs`、`src/core/augment-icons.cjs` | 后台 HUD 图标匹配与稳定槽位 |
| `src/core/native-itemsets.cjs`、`src/core/lcu-itemsets.cjs`、`src/core/native-itemsets-sync.cjs` | 原生方案生成、窄 LCU 读写、身份与冲突校验、回滚及节流 |
| `src/core/runtime-diagnostics.cjs` | 补丁兼容、扫描预算退避及诊断导出白名单 |
| `src/core/recommendations.cjs` | 海克斯指数、阵容候选、出装、`matchupRecommendations` 对局装备适配及条件刷新参考 |
| `scripts/run-api-smoke.cjs`、`scripts/api-smoke.cjs` | 无截图的接口模式 DOM 与状态检查 |
| `scripts/run-light-smoke.cjs`、`scripts/probe-roi-performance.cjs` | 离线流程检查与受限 ROI 性能探针 |
| `src/renderer` | 自绘控制面板、强化卡片、商店与选人浮层 |
| `data/seed`、`data/static` | OP.GG 快照与 Riot 描述性属性 |
| `docs/NO_CAPTURE_RESEARCH.md` | v0.2.2 无截图路线历史调研；当前状态以本 README 与发布记录为准 |

## 来源

资料来自 [OP.GG 海克斯大乱斗](https://op.gg/zh-cn/lol/modes/aram-mayhem)，描述性属性来自 [Riot Data Dragon](https://developer.riotgames.com/docs/lol#data-dragon)。公开页面解析不是 OP.GG 承诺稳定的开放 API。游戏资料、图片及依赖保留各自权利与许可，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

Hexthon isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.
