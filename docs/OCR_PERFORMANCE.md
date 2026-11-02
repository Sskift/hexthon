# 视觉路径性能审查与 Sygnano 适配方案

初次审查：2026-11-02；最新更新：2026-11-03。本页包含旧基线源码审查，以及本轮新增轻量路径的实现与离线测试结果；没有真实游戏帧率基准测试。本轮视觉验证没有采集用户屏幕、监控对局、运行视觉 smoke 或启动竞品程序。

Hexthon 审查基线为 `a78013c1a5c1b548a3750060e232b7a4920da2cf`。该版默认接口模式不启动截图、OCR、图标匹配与原生窗口监控。以下旧路径问题只在实验视觉入口运行时生效，不能据此认定当前默认模式仍产生同样开销。

## 当前实现与已完成验证

默认 API 模式仍不采集画面。新增开发入口 `--visual-light-experimental` 已接入独立的轻量路径：指定游戏 HWND 的客户区 → GDI 抓取 reroll 按钮条带 → NCC 模板检测 → 有按钮证据才抓窄标题 ROI → 标题指纹判断变化 → 必要时调用常驻 Windows 中文 OCR。它绕过旧 `desktopCapturer` 全窗口缩略图、70.56% 大区域 OCR 和持续 HUD 图标匹配；默认启动、接口失败和自动重连不会开启它。

`src/core/scene-gate.cjs` 已适配 Sygnano 的高度缩放布局、reroll 模板相关和分条带指纹，保留上游归属及许可。常驻 `WindowsOcrWorker` 使用内存 BGRA 协议，不逐次启动 PowerShell 或落盘 PNG；标题读取通过 `allowSmall` 支持窄区域。轻量入口同时设置 `allowFallback: false`：Windows OCR 失败或进入冷却时保持未知，不自动下载模型或启动 Tesseract；旧视觉实验仍保留原后备路径。完整三张牌已稳定且指纹未变化时，可在 2 秒缓存窗口内复用识别结果。

轻量分支当前只处理选卡，**不支持商店识别或 HUD 已选海克斯恢复**。它没有移植上游的隐藏按钮、完整卡框扫描或定时大图巡检；reroll 模板可能漏检，未检测到时不调用 OCR，也不会自动回退到大图。没有按钮证据不保证不存在选卡页面；捕获候选卡片也不保证已选海克斯历史完整。

| 验证 | 本轮结果 | 解释范围 |
| --- | --- | --- |
| reroll 门控，上游已有正例截图 | 15/15 检出 | 来自上游已有样本，涵盖多个分辨率；不是 15 次国服实时识别。 |
| 错行区域与真实非选卡截图 | 15 个错行区域误报 0；11 个真实负例误报 0 | 11 个负例包含属性锻造卡与选人界面。样本有限，不代表全部场景零误报。 |
| NCC 门控图像计算 | 中位 1.60 ms，P95 2.14 ms | 已解码 ROI 上的计算，不含真实 GDI 采集、IPC、OCR、浮层或游戏帧时间。 |
| 标题 fingerprint 计算 | 中位 1.16 ms | 同样只测图像计算，不是整个识别流程耗时。 |
| 常驻 OCR 原始 worker | 首次 398 ms；后续 21–33 ms，5 次调用只启动 1 个 worker | 1920×1080 既有合成整图的离线输入，包含 worker 往返；不是新标题 ROI 端到端实测。 |
| 旧单次 PowerShell OCR 对照 | 332–394 ms/次 | 本轮旧流程的离线命令对照记录。与上行比较说明进程/传输热路径改善，不是 FPS 改善比例；首次启动仍有约 398 ms 成本。 |
| 新 targeted GDI capture | 编译及协议测试已通过 | 尚未针对真实游戏执行采集验证，没有国服窗口位置、DPI/全屏兼容性、持续资源占用或 FPS 结果。 |

门控数据见本地 `.qa/scene-gate-benchmark.json`；其中最低正例分数 0.7714，所测负例最高分数 0.4119。常驻 OCR 数据见 `.qa/ocr-worker-benchmark.json`；后者只保存新实现测量，旧流程 332–394 ms 来自本轮命令对照记录。这些 `.qa` 文件不随仓库提交。`OcrReader` 包装层另测得首次 408 ms、后续 27/40 ms，不能与原始 worker 或新 GDI 全流程混为一个指标。

Overwolf 是另一条独立实验路线；官方运行时已启动，但 GEP 尚未 ready，国服事件兼容性未验证，见 [Overwolf 实验实测](OVERWOLF_EXPERIMENT.md)。

### 可复现的窄标题联通检查

执行 `node scripts/check-light-offline.cjs`。脚本仅在隐藏离屏 Canvas 生成合成图，禁用网络，不读取用户窗口画面；输出 `.qa/light-offline/report.json`。三个分辨率下的标题条分别为 1006×85、954×81、1342×114，阳性对照“珠光护手 / 小蜜蜂！！！ / 升级：无尽之刃”含两行标题，共 9 次读取均正确映射三卡。此轮 OCR 冷启动 330 ms，稳态 9–11 ms，首次较大尺寸 23 ms；名称与坐标映射约 0.12–0.45 ms。只有一个 OCR worker。这些仍是合成图结果，不包含 GDI 采集与真实帧率。

脚本同时保留困难观察：“会心治疗”在 27 px 常规字重时被拆字，当前精确匹配拒绝显示；仅离线预放大至宽 2200 后恢复。26 px 较粗字重出现“疗→疔”，放大仍然拒绝。生产缩放和匹配没有为这些合成样本特殊修改。缺一个标题会触发指纹变化并停止显示；没有模糊猜测来凑出三张卡。后续需以国服实际字体样本验收 OCR 准确率。

## 判断

问题不能简化为“OCR 天生卡”或“换 Rust 就不卡”。旧流程在确定海克斯页面存在之前，已经请求窗口大图、转换整图位图、匹配 HUD 图标，并 OCR 大面积画面；原生 OCR 还逐次启动 PowerShell、编码临时 PNG 再解码。成熟开源实现提供了直接可借鉴的减少工作量的方法：指定矩形采集、廉价页面预检测、窄标题识别、结果指纹缓存、常驻引擎和独立工作线程。

这些机制可以确认存在，本轮已对新门控与常驻 OCR 做离线测量；真实采集链路的耗时排序以及游戏帧率影响仍需测量。不能把上游作者的速度注释当成本机实测，也不能声称竞品永不卡。

## Hexthon 旧路径的具体成本

表中行号对应上述旧提交，保留用于解释改造原因；它不是新 `--visual-light-experimental` 路径的当前行为描述。

| 位置 | 已确认机制 | 优化含义 |
| --- | --- | --- |
| `src/controller.cjs:206` | `desktopCapturer.getSources({types:['window'],thumbnailSize:{width:2560,height:1440}})` 后才按游戏 HWND 选取来源 | API 请求窗口列表与缩略图，无法通过这次调用只指定一个 HWND。应直接抓游戏客户区内所需矩形；Electron 官方说明逐窗口/屏幕缩略图有采集处理成本。 |
| `src/controller.cjs:210–211` | 游戏缩略图整体 `toBitmap()` 后同步调用 `matchAugmentIcons` | 2560×1440 BGRA 缓冲区约 14.1 MiB；位图转换与 JS 匹配占用 Electron 主进程执行时间。匹配器内部积分图已经限定 HUD 区域，不应误称为整图积分计算。 |
| `src/controller.cjs:222` | OCR 区域为 x/y 0.08，宽/高 0.84，即画面面积 70.56% | 尚未确定选卡页面就识别战斗、HUD、商店等大量无关文字。对 2560×1440 输入，裁剪约 2150×1209，再由 OCR 缩放到约 2200×1237，即约 272 万像素；这是尺寸计算，不是耗时测量。 |
| `src/controller.cjs:228–229` | 一些结果不足以定位卡片时，对同一张图进行第二遍 OCR | 一次轮询可能串行支付两次识别成本。固定布局标题读取应一次完成，低置信度保持未知或延后重试。 |
| `src/controller.cjs:243–245` | 游戏前台且 Live Client 已连接就进行扫描；扫描结束后再等 1300 ms | 没有选卡页面或变化门控，普通战斗也承担识别成本。已有 busy/await，不是无限并发排队。 |
| `src/core/ocr.cjs:73–86`、`src/native/ocr.ps1:5–28` | 每次原生识别编码 PNG、写磁盘、启动 PowerShell、加载 WinRT、新建 OCR 引擎、打开文件并解码 | 启动与数据往返可移出热路径，改常驻引擎与内存像素协议。旧 Tesseract 后备 worker 已缓存，不是每轮重建。 |
| `src/core/ocr.cjs:90–104` | 后备路径在主进程遍历裁剪像素灰度化/增强，再编码 PNG | 如果主路径不可用会增加额外 CPU/内存成本。需错误冷却、可观测的降级状态，并限制并发。 |
| `src/core/window-monitor.cjs:10–40`、`src/native/window-monitor.ps1:86,105–111` | 一个常驻 PowerShell helper，每 60 ms 输出窗口/鼠标状态，约每 1500 ms 重发现窗口 | 不是每 60 ms 启动一个进程。可降低几何信息刷新率、只在需要判断选择时快速读鼠标、状态变化才输出；这是次优先级，尚无证据证明它是主因。 |

[Electron desktopCapturer 官方文档](https://www.electronjs.org/docs/latest/api/desktop-capturer) 明确说明，将 `thumbnailSize` 宽高设为 0 可以省去捕获每个窗口或屏幕缩略图的处理。这里需要像素，因此真正的替代是目标矩形采集，不能只把缩略图设为 0 后期待 OCR 继续工作。

本轮常驻 OCR 与轻量采集分支的实现、离线结果见页首。旧视觉入口仍作为历史实验路径保留，不能将它与新轻量入口或默认 API 模式混用；仅修常驻 OCR 本来也不足以消除旧分支的大图采集、宽区域 OCR 或主进程 HUD 匹配。

## 开源实现对比

| 项目 | 源码中可确认的处理 | 局限与可复用程度 |
| --- | --- | --- |
| [Sygnano/aram-mayhem-tracker](https://github.com/Sygnano/aram-mayhem-tracker) | GDI 只抓所需矩形；先找 reroll 小条带和隐藏按钮，再抓卡片区；OCR 只读标题；指纹未变则复用；独立视觉线程；惰性创建并缓存 OCR 模型 | 明确 MIT，最适合抽取模块。仍是局部截图；没有证据证明腾讯国服直接兼容。窗口英文标题、几何/模板、名称库都要适配。 |
| [CyberKird/aram-mayhem-helper](https://github.com/CyberKird/aram-mayhem-helper) | `ingame-app/ocr_augments.py:124` 缓存 WinRT OCR 引擎；`:178` mss 矩形抓取；`:200` 内存 BMP；`:517` 三条标题带快速识别；`:479,574` 连续空结果若干次才完整识别。`app.py:52,321` 分状态节奏与后台 OCR 线程 | GPLv3。可研究机制；直接移入 MIT 项目须处理 GPL 要求，故本次优先选择明确 MIT 的 Sygnano。默认使用英语 OCR；窄区域也仍会周期性识别，不能描述成完全事件驱动。 |
| [zp96-cmd/mayhem-overlay](https://github.com/zp96-cmd/mayhem-overlay) | `ocr.js:8` 缓存 Tesseract worker，`:112` 0.6 倍缩放；`main.js` 只在 pending offer/active offer 状态调度 OCR，等待/活动间隔为 2200/1300 ms | 抓主屏整图后裁剪，默认调试 PNG 写盘，不值得照抄采集层；英语模型。`package.json` 标 MIT，但审查时未看到根 LICENSE 正文，归属处理不如 Sygnano 清楚。 |

以上是公开源码事实，不推断 Blitz、OP.GG Desktop 或 Porofessor 私有程序的底层采集方式。上游性能注释只代表作者环境，不能取代 Hexthon 的测量。

## 已取得的官方上游与许可

已只读 clone 至 `.research/aram-mayhem-tracker`，remote 为 `https://github.com/Sygnano/aram-mayhem-tracker.git`，固定 HEAD 为 `ecfa004fe855a2a5dfbb2c37b818039f5bc72bf1`。该目录由现有 `.gitignore` 排除，不作为 Hexthon 整体源码提交。没有启动上游程序或安装依赖。

[上游 LICENSE](https://github.com/Sygnano/aram-mayhem-tracker/blob/ecfa004fe855a2a5dfbb2c37b818039f5bc72bf1/LICENSE) 为 MIT，版权人为 2026 Sygnano。移植或翻译实质代码时，保留版权与许可正文，在文件/第三方说明中记录上游路径、提交及修改内容。

[THIRD_PARTY_NOTICES.md](https://github.com/Sygnano/aram-mayhem-tracker/blob/ecfa004fe855a2a5dfbb2c37b818039f5bc72bf1/THIRD_PARTY_NOTICES.md) 单列 PP-OCRv4 中文识别模型及字表为 Apache-2.0。卡框和按钮图片来自游戏资产或截图，不能因为代码是 MIT 就改称全部游戏美术也是 Sygnano 原创 MIT；保留来源说明。首步可以沿用当前 Windows 中文引擎，仅移植采集与门控，不引入整套 Tauri、Rust 推理和模型依赖。

## 上游可移植模块与本轮取舍

所有下列链接都固定到已检查的上游提交。下表描述上游模块，并非声称 Hexthon 已移植全部内容；本轮实际只采用 targeted GDI、布局、reroll 门控和指纹，OCR 继续使用 Windows 中文引擎。

| 模块 | 精确源码入口 | 适配边界 |
| --- | --- | --- |
| 矩形采集接口 | [capture.rs:9](https://github.com/Sygnano/aram-mayhem-tracker/blob/ecfa004fe855a2a5dfbb2c37b818039f5bc72bf1/crates/mayhem-vision/src/capture.rs#L9) 的 `ScreenCapture`，`:41` 的 `capture_regions` | `game_client_rect()` 返回物理像素客户区；`capture(rect)` 只返回该区像素。合并邻近区域一次抓取后切片。保留 `StillCapture` 以离线测试，不依赖运行游戏。 |
| Windows 采集 | [windows/capture.rs:73](https://github.com/Sygnano/aram-mayhem-tracker/blob/ecfa004fe855a2a5dfbb2c37b818039f5bc72bf1/crates/mayhem-vision/src/windows/capture.rs#L73)，`:106` 的实现 | `GetClientRect` + `ClientToScreen`；`GetDC`/`CreateDIBSection`/`BitBlt(SRCCOPY)`；BGRA 转 RGBA；释放 GDI 资源。没有窗口列表缩略图、PNG 或视频流。可翻译成现有常驻 Windows helper 的 C# 实现，不必引入整个 Rust 应用。 |
| 几何 | [geometry.rs](https://github.com/Sygnano/aram-mayhem-tracker/blob/ecfa004fe855a2a5dfbb2c37b818039f5bc72bf1/crates/mayhem-core/src/geometry.rs)、[layout.rs](https://github.com/Sygnano/aram-mayhem-tracker/blob/ecfa004fe855a2a5dfbb2c37b818039f5bc72bf1/crates/mayhem-core/src/layout.rs) | 牌面横向以客户区中心为锚点、尺寸按客户区高度缩放，避免直接按屏幕宽度比例导致超宽屏错位。先作为可配置候选值，须用现有国服样本确认。 |
| 页面门控 | [offer.rs:128](https://github.com/Sygnano/aram-mayhem-tracker/blob/ecfa004fe855a2a5dfbb2c37b818039f5bc72bf1/crates/mayhem-vision/src/offer.rs#L128) `scan_cards` | 顺序为 `scan_rerolls` → 必要时 `scan_button` → 有证据或安全巡检时 `scan_card_area`。`cards_on_screen()` 与 `augment_screen_open()` 分开，避免把收起牌面当成已结束选卡。 |
| 模板检测 | [reroll.rs](https://github.com/Sygnano/aram-mayhem-tracker/blob/ecfa004fe855a2a5dfbb2c37b818039f5bc72bf1/crates/mayhem-vision/src/reroll.rs)、[button.rs](https://github.com/Sygnano/aram-mayhem-tracker/blob/ecfa004fe855a2a5dfbb2c37b818039f5bc72bf1/crates/mayhem-vision/src/button.rs)、[frames.rs](https://github.com/Sygnano/aram-mayhem-tracker/blob/ecfa004fe855a2a5dfbb2c37b818039f5bc72bf1/crates/mayhem-vision/src/frames.rs)、[imageops.rs](https://github.com/Sygnano/aram-mayhem-tracker/blob/ecfa004fe855a2a5dfbb2c37b818039f5bc72bf1/crates/mayhem-vision/src/imageops.rs) | 缩小候选区后做模板相关；卡框提取轮廓等特征。所需资产位于 `crates/mayhem-vision/assets/{reroll,button,frames}`。不把宽区域多尺度匹配直接搬入 Electron 主线程。 |
| 变化检测 | [offer.rs:329](https://github.com/Sygnano/aram-mayhem-tracker/blob/ecfa004fe855a2a5dfbb2c37b818039f5bc72bf1/crates/mayhem-vision/src/offer.rs#L329) `Fingerprint` | 每个标题块缩成 32×24 灰度图；按 32×8 条带取最大平均绝对差。不能把整组三张牌平均，因为只刷一张/一行会稀释变化。 |
| 调度与缓存 | [engine/vision.rs:45](https://github.com/Sygnano/aram-mayhem-tracker/blob/ecfa004fe855a2a5dfbb2c37b818039f5bc72bf1/apps/desktop/src-tauri/src/engine/vision.rs#L45)，`:315,433` | 原实现 2 秒 OCR 保护重读、2 秒无按钮卡框巡检、指纹阈值 4.0、独立线程。阈值和周期是参考初值，不是国服验证结果。无按钮巡检仍会抓较大的牌面区，因此不能声称日常战斗永远只抓小条带。 |
| 可选 OCR 后端 | [paddle.rs](https://github.com/Sygnano/aram-mayhem-tracker/blob/ecfa004fe855a2a5dfbb2c37b818039f5bc72bf1/crates/mayhem-vision/src/paddle.rs) | 使用 PP-OCRv4 中文识别模型，只做已知标题行的文字识别，不做整图文本检测；模型缓存。上游对多个标题并行推理，有限 CPU 上可能产生尖峰，须比较单 worker 与并行配置。中文模型不等于已经通过腾讯国服界面验证。 |

Windows 适配须处理这些实际差异：

1. 上游 `windows/capture.rs:18–19` 同时匹配 `RiotWindowClass` 与英文标题。国服使用 Hexthon 已发现的可信 HWND/PID，不要求英文标题；检查窗口仍存在、未最小化、当前为前台。读取不能激活窗口或模拟输入。
2. 统一物理像素、DPI、客户区坐标和多屏负坐标。上游 `capture(rect)` 本身不会替调用方验证前台，不能直接复用后遗漏这项检查。失焦/尺寸变化需清理旧卡片结果。
3. 上游 GDI 从桌面矩形复制像素；这是有条件的可见区域采集。`SRCCOPY` 特意不含 `CAPTUREBLT`，意图排除 layered 浮层，但不能保证所有 Windows 合成/独占全屏行为一致。未验证的显示模式应停止此路径，避免自动退回整屏高负载抓取。
4. 旧 `OcrReader.read` 要求源图至少 400×250；本轮已新增显式 `allowSmall`，轻量路径使用该选项读取窄标题条，并按标题 ROI 映射回客户区坐标。映射已实现，不等于国服实际牌面位置已验证。
5. 隐藏按钮模板含游戏 UI 纹理，国服文字、补丁、HUD 设置和遮挡要用样本验证。先优先语言依赖小的 reroll/卡框证据；不能将欧美截图通过等同于国服通过。

## 落地状态与后续优先级

| 优先级 | 工作 | 相对成本 | 验收要点 |
| --- | --- | --- | --- |
| P0 | 常驻 Windows OCR、内存 BGRA、失败冷却、阶段计时 | 小至中；已实现并有离线测量 | 合成图连续识别只启动一个 helper；热路径不写截图文件。继续关注长期资源占用与退出行为。 |
| P0 | 替换全窗口缩略图为指定 HWND 客户区内的 ROI 采集 | 中；轻量入口已实现，编译/协议测试通过 | 实际游戏采集、DPI、窗口坐标、显示模式及 GDI 句柄稳定性仍待验证。 |
| P0 | 移植 reroll 门控、窄标题识别、指纹缓存 | 中；已实现并通过上述离线样本 | 持续补充真实负例/国服位置样本；无按钮时停止 OCR。当前没有自动大图保护巡检，需接受模板漏检边界。 |
| P1 | 把图像预处理与模板匹配从 Electron 主进程移到常驻 helper/worker | 中 | 主进程只编排与显示；队列至多一个有效任务，丢弃过期结果，不追赶积压帧。 |
| P1 | HUD 已选图标改为有理由的恢复/校正操作，指针追踪按选卡状态启停 | 中；轻量入口当前禁用 HUD 恢复 | 不把候选牌面消失当成已选择证明；无完整来源时仍标记不完整。 |
| P2 | 预计算名称标准化、缓存模板尺寸、减少无变化 IPC | 小 | 根据计时证据优化；不得为了少量 CPU 收益破坏刷新/跨分辨率正确性。 |
| 后续 | 比较 Windows 中文 OCR 与 PP-OCRv4 标题识别 | 中至大 | 固定离线国服样本比较准确率、首启/稳态耗时和峰值 CPU；不先下载/安装全套竞品来赌性能。 |

建议数据接口只传 `{hwnd, clientRect, scene, slots, confidence, capturedAt, timings}` 等结果到现有 Electron 层，OP.GG 数据、规则分和浮层样式继续复用。不要为移植视觉模块一并搬入上游云服务、桌面 UI 或无关功能。

这些移植只解决选卡页面的识别效率。商店开关、已选海克斯完整恢复、敌我阵容/装备联动是不同问题；捕获三张候选和看到牌面关闭，不能单独证明玩家选择了哪一张。

## 验证计划与本次边界

本轮已采用上游 `StillCapture` 的依赖注入思路，在已有截图/合成图上完成页首列出的门控与 OCR 验证。后续仍需覆盖更多战斗负例、相同指纹复用、单牌单行变化、国服实际位置、按钮遮挡和收起牌面、失焦清理及超时后无任务积压。模板识别不能只用“生成模板再识别同一模板”的测试代替真实复杂画面。

计时应分别记录采集、场景检测、图像转换、OCR 引擎、名称匹配、IPC 和总耗时，汇总 P50/P95、采集次数、OCR 次数、每次像素量、helper 启动次数及内存/GDI 句柄趋势。不得在性能日志中写入原始截图、OCR 全文或账户信息。

真实流畅度最终需要同等游戏设置、同类场景下的关闭助手/开启助手对照以及帧时间分布。此次没有启动该验证，因此没有本机 FPS 改善数值，也没有“已经不卡”的结论。
