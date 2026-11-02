# 帧时间与 ROI 性能验收

核查日期：2026-11-03。本轮完成了可运行的独立诊断工具、官方便携程序校验、ETW 隔离检查及数据处理测试。**没有取得国服实局 FPS 或真实 ROI 样本**：后台只读窗口检查发现客户端，未发现游戏窗口；正式入口均返回 `NO_FOREGROUND_LEAGUE`。不能据此宣称流畅度改善或实局识别已经验收。

## 工具来源与准备

使用 Intel 官方仓库发布的 **PresentMon 2.6.0 独立控制台程序**，不使用 MSI、GUI、服务或驱动安装器。官方将 ETW 收集库、独立 Console、Service 和 Capture UI 区分为不同组件；本工具只调用独立 Console。[官方组件说明](https://github.com/GameTechDev/PresentMon/blob/v2.6.0/README.md)、[2.6.0 发布页](https://github.com/GameTechDev/PresentMon/releases/tag/v2.6.0)

```powershell
node scripts/prepare-presentmon.cjs
```

准备脚本固定下载官方 `PresentMon-2.6.0-x64.exe`，文件大小为 980,320 字节，并验证官方 release asset 的 SHA-256：

```text
b2a706bc6ad475749e3b7e3409263aa1e6906d45bdcf993f6dbc0f660188f1af
```

程序、MIT 许可和来源记录保存在被 Git 忽略的 `.research/presentmon/`。脚本不执行安装、提权、注册表或用户组修改，也不开始采集。本机额外检查了 Authenticode：状态为 `Valid`，签名方为 `Intel Corporation`。隐藏运行 `--help` 确认了目标 PID、stdout、定时与退出参数。每次正式探针启动前仍会重新校验固定 SHA-256；二进制不存在或不匹配时拒绝启动。

## 可复现命令

```powershell
# 只验证参数和边界，不启动 helper、ETW 或写文件
node scripts/probe-fps-performance.cjs --dry-run

# 仅跟踪本脚本自己的无渲染进程 1 秒，验证 CLI/ETW 的启动与回收
node scripts/probe-fps-performance.cjs --isolation

# 游戏已经在前台时，由后台任务运行；只跟踪该游戏进程
node scripts/probe-fps-performance.cjs --seconds=10

# 独立 ROI 耗时探针：reroll 3 次、title 1 次、HUD 1 次
node scripts/probe-roi-performance.cjs
```

正式 FPS 探针只接受 **10–20 秒**的时长；1 秒仅供 `--isolation`，且目标被固定为脚本自己的进程。正式入口不接受任意 `--pid`，由只读 `WindowMonitor` 确认前台、可见、未最小化的游戏 HWND/PID。运行命令本身不会把游戏切到前台；如果从前台终端启动导致游戏失去前台资格，应得到不可用结果，而不是由脚本抢回焦点。

它不会启动主 Hexthon 或恢复持续识别，不按键、不移动鼠标、不创建可见浮层、不截图、不读取玩家名称。ROI 探针与 FPS 探针各自独立；ROI 只短暂处理指定小区域的 BGRA，在统计后清零，不运行 OCR、不落盘图像。

## FPS 采集与退出边界

独立 Console 使用 `--process_id`、`--timed`、`--terminate_after_timed`、`--terminate_on_proc_exit`、`--output_stdout` 和唯一 `--session_name`。禁用输入与 GPU 工作时长跟踪，保留帧提交和展示间隔；不使用热键、滚动锁提示、提权、应用注入或全进程记录选项。[官方 CLI 说明](https://github.com/GameTechDev/PresentMon/blob/v2.6.0/README-ConsoleApplication.md)

- 每次生成新的 `HexthonFPS-<UUID>` ETW 会话名，不接管或停止默认 PresentMon 会话。
- 按目标 PID 过滤记录，并在 JavaScript 解析层再次丢弃其他 PID 的行。ETW 提供者可能在内部产生系统范围事件，本工具只对目标行做统计，不保存其他进程数据。
- 前台游戏、窗口几何或 DPI 变化会取消本轮；窗口观测超过 1 秒未更新也会取消，不把停滞的监控结果视为当前前台证据。
- Console 自行按时退出；Node 另设“请求时长 + 1.8 秒”的停止看门狗及“请求时长 + 3.8 秒”的最终退出保护。
- 取消时先结束本次 collector；观察到进程退出后，才执行该次随机会话名的 `--terminate_existing_session`。这样不会把启动阶段的“会话尚不存在”误当成最终释放。官方源码把“没有这个会话”作为明确返回分支；清理不确认时报告 `OWN_SESSION_CLEANUP_UNVERIFIED`。最终退出保护触发却未观察到进程退出时，`collectorExitConfirmed` 和 `etwCleanup.confirmed` 均为 `false`，不会把 kill 请求当成已退出的证据。不会按进程名结束别人的 PresentMon。[官方会话终止实现](https://github.com/GameTechDev/PresentMon/blob/v2.6.0/PresentMon/MainThread.cpp)
- 不自动申请管理员权限或修改 `Performance Log Users` 成员关系。当前令牌无法开启 ETW 时，保留 `ETW_ACCESS_DENIED`。官方说明了这项权限要求，但脚本不会替用户改变机器策略。[官方权限说明](https://github.com/GameTechDev/PresentMon/blob/v2.6.0/README.md#user-access-denied)

原始 CSV 只在内存中流式解析，不写 CSV 或 ETL。输出大小、行数和交换链数量都有上限；只保留计算分位数所需的有界数字数组。最终报告不含 PID、窗口标题、交换链地址、程序路径、输入事件或画面。

## 如何读结果

FPS 报告写入 `.qa/fps-performance.json`；隔离报告写入 `.qa/fps-isolation.json`。ROI 报告写入 `.qa/roi-performance.json`。没有有效帧时，均值/FPS 为 `null`，不能解释成 0 FPS，也不能解释成通过。

| 状态或原因 | 含义 |
| --- | --- |
| `measured` | 收到了足够的目标主交换链间隔，正常结束并确认会话清理；仍只是本次短观察。 |
| `NO_FOREGROUND_LEAGUE` | 没有合格的前台游戏窗口；不会启动 FPS collector 或 ROI capture helper。 |
| `PRESENTMON_NOT_PREPARED_OR_HASH_MISMATCH` | 官方便携程序未准备或校验失败；不会执行该文件。 |
| `NO_TARGET_FRAMES` | 进程没有产生可用目标帧，或当前 ETW 路径没有提供帧；不推断真实帧率。无渲染隔离检查应得到这个结果。 |
| `INSUFFICIENT_TARGET_FRAMES` | 主交换链有效提交间隔不足 30 个，不能作为已测量结果。 |
| `ETW_ACCESS_DENIED` | 当前权限无法启动 ETW，不进行提权或策略更改。 |
| `UNSUPPORTED_CSV_SCHEMA` | 输出列不符合已验证的格式，不猜测字段含义。 |
| `ETW_EVENTS_LOST` | 检测到事件丢失，不能把剩余样本当完整帧序列。 |
| `TARGET_CHANGED` / `TARGET_NOT_CURRENT` | 目标上下文已改变，本轮停止。 |
| `TIME_BUDGET_REACHED` / `OUTPUT_LIMIT` / `SWAPCHAIN_LIMIT` | 达到有界保护，不继续无限等待或积累数据。 |
| `COLLECTOR_START_FAILED` / `COLLECTOR_EXIT_FAILED` | 收集器不能启动或异常退出，不输出“通过”。 |
| `OWN_SESSION_CLEANUP_UNVERIFIED` | 没有确认自有会话释放，不能把这轮视为完整完成。 |
| `etwCleanup.reason: COLLECTOR_EXIT_UNVERIFIED` | 停止请求后未观察到 collector 退出；即使停止会话命令成功，也不能确认初始化竞态已经结束。 |

一个进程可能有多个交换链。本工具选择有效提交间隔最多的交换链，并报告所占样本比例；不把所有交换链的帧数直接相加。报告分别给出 `presentIntervals` 和 `displayIntervals` 的均值、P50、P95、P99、最大间隔与样本量。平均 FPS 定义为 `1000 / 平均间隔毫秒`，不是逐帧 FPS 的算术平均。丢弃帧仍可计入提交间隔，但不作为展示间隔样本。字段定义来自官方文档。[提交与展示指标定义](https://github.com/GameTechDev/PresentMon/blob/v1.9.2/README.md#csv-columns)

`targetRowsSeen` 统计处理范围内的目标 PID 行；`targetFrames` 和 `selectedSwapchainShare` 的分母只包括交换链字段有效的行，非法目标行单独计入 `targetRowsDiscarded`。间隔为零、无效或超过上限的行不会计入均值，剔除数分别记录在 `presentIntervalsDiscarded` / `displayIntervalsDiscarded`。展示间隔还要求明确的“未丢弃”状态，缺失或未知状态记录为 `unknownDropStatusFrames`，不冒充展示样本。

## 本机实际记录

2026-11-03 的执行记录如下。只读窗口快照显示 **客户端存在、游戏窗口不存在、无前台游戏**。

| 检查 | 实际结果 |
| --- | --- |
| 官方下载与校验 | 固定 SHA-256 匹配；Authenticode `Valid / Intel Corporation`。 |
| `--dry-run` | 0 helper、0 ETW、0 文件写入。 |
| `--isolation` | 实际 ETW/CLI 运行约 1.119 秒，exit code 0，无强制结束，自有会话清理确认。目标为无渲染脚本进程，帧数 0，正确报告 `NO_TARGET_FRAMES`。 |
| 正式 FPS 入口 | `NO_FOREGROUND_LEAGUE`，`collectorStarted: false`，没有游戏帧样本。 |
| 正式 ROI 入口 | `NO_FOREGROUND_LEAGUE`，capture helper 启动 0 次、像素 0、样本数组为空。窗口监控 helper 累计 CPU 约 265.625 ms；这不是游戏帧时间。 |
| 处理与边界测试 | `tests/presentmon-probe.test.cjs` 与 `tests/roi-performance-probe.test.cjs` 合计 20/20 通过。除读取测试进程自己的累计 CPU 的 Windows 检查外，测试使用合成 CSV、假进程及假采集数据；包括退出后清理、未确认退出、停滞监控及样本剔除回归。 |

本轮还修复了 ROI 诊断脚本 CPU 查询代码少一个闭合花括号、导致字段一直为 `null` 的问题。已用测试进程自身验证，并增加对应 Windows 回归检查；不涉及生产采集/OCR 的行为变化。

## 尚未完成的实局验收

FPS、ROI 耗时、截图识别率和浮层时机是不同的验证项目。当前工具没有取得国服真实目标帧，也没有证明商店/三卡/HUD 多局识别通过。一个短 FPS 样本不能证明助手导致或消除了卡顿。

后续 A/B 对照应固定游戏显示模式、分辨率、缩放、帧率上限与可重复场景，记录主交换链和样本量，并分开比较助手暂停与启用。应重复多轮并比较帧时间分布，避免把不同战斗强度、窗口切换、加载、网络变化或其他后台任务的差异当成助手影响。探针本身也有开销；独立测量不能自动给出因果结论。本工具不会为了制造对照而自动开启主助手、切换游戏或替用户操作。
