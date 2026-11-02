# 便携更新与后台入口

适用版本：Hexthon 0.4.1。更新是项目自主实现的便携目录方案，不是 Electron `autoUpdater`，不安装服务或驱动。检查、下载和安装均由用户在自绘设置页点击发起；没有定时自动下载或自动安装。

## 使用流程

1. 点击 **检查更新**，读取 `Sskift/hexthon` 的最新正式 GitHub Release。没有正式 Release 时显示尚未发布；源码提交或 Actions 构建产物不自动成为更新。
2. 发现比当前版本新的正式版后，点击 **下载更新**。核对完整 ZIP 后解压到独立目录，校验清单与每个文件，完成后显示可安装。
3. 退出选人和对局后点击 **重启并安装**。旧进程正常退出，新进程通过启动健康检查后才切换后续入口；失败时尝试恢复旧版本及配置。
4. 后续使用 **`Start-Hexthon.vbs`** 自动选择已提交的更新入口；**`Stop-Hexthon.vbs`** 请求正常退出。原目录保留，可用于故障诊断和手动恢复。

启动器默认传入 `--assist`，不会清除暂停设置、传入 `--panel` 或切换前台。它先检查 `%APPDATA%\Hexthon\updates\active-path.txt` 的固定 key 格式及必要文件，再回退到所在目录的便携 EXE／源码 Electron。`launcher-status.json` 的 `requested` 仅说明请求已发出，实际运行需结合 `runtime-status.json` 和更新结果判断。带 `%变量%` 语法的路径会拒绝，不让路径在启动时变成其他位置。

## 校验与切换

- **来源固定**：仅使用 `https://api.github.com/repos/Sskift/hexthon/releases/latest`。接受 `v主.次.补丁` 正式版本及唯一的 `Hexthon-<版本>-win32-x64.zip`，拒绝草稿、预发布、降级、未知资产格式和没有 SHA-256 的资产。网络仅允许实现中列出的 GitHub HTTPS 域名及有界重定向。
- **资产摘要**：ZIP 字节数和 SHA-256 必须符合 GitHub Release API 的资产信息。GitHub 官方说明上传时生成资产摘要，Release REST API 可读取 `digest`；这是下载完整性依据，不是本项目的发行者代码签名。[Release API](https://docs.github.com/en/rest/releases/releases) · [资产摘要说明](https://github.blog/changelog/2025-06-03-releases-now-expose-digests-for-release-assets/)
- **解压与清单**：限制包大小、展开总量、单文件和文件数；拒绝目录穿越、符号链接、重复路径及不支持的 ZIP 形式。检查必要文件、package 身份、版本、未列入清单的文件，以及全部文件长度与 SHA-256。
- **清单连续性**：下载校验后保存 `manifest.json` 原始字节的 SHA-256，准备安装和切换前必须匹配这个冻结值，再核对全部文件；不会仅信任缓存目录中新出现的自述清单。
- **独立目录**：写到 `updates/packages/<版本>-<摘要前缀>-<随机后缀>/Hexthon-win32-x64`，不覆盖正在运行的程序。安装计划、准备确认和健康记录使用各自令牌及匹配的进程／版本信息。
- **退出和健康检查**：等待旧进程退出，保存 `settings.json` 与 `selection-history.json` 检查点，再启动新版。新版初始化后写入匹配令牌、PID、版本及新鲜时间的 ready 记录；还需连续存活 1.5 秒才提交 `active.json` 与 `active-path.txt`，避免刚报 ready 就崩溃仍切换成功。
- **失败恢复**：停止本次启动的自有子进程，恢复设置、历史及此前入口，再尝试启动旧版并验证其健康记录；无法确认恢复成功时报 `rollback-failed`，不会冒称已经回退。已有版本目录不自动删除。

这些检查保护下载和更新流程的一致性，不替代发行签名，也不保证运行策略会允许 EXE。程序不会修改 App Control、执行策略或自动提权。

## 对局保护与诊断

下载和安装要求 API 阶段为允许的空闲状态、没有 Live Client 对局连接和已见游戏窗口；还通过有界、隐藏的进程查询确认 `League of Legends.exe` 不在运行。查询失败按不能更新处理。安装关键切换点重新检查游戏状态，下载与验证过程中也检查已知状态是否改变；不自动退出或结束游戏。

主要文件在 `%APPDATA%\Hexthon\updates`：

| 文件／目录 | 用途 |
| --- | --- |
| `packages` 与对应 ZIP | 已下载的独立版本目录和原始包 |
| `staged.json` | 已校验版本、资产摘要和冻结清单摘要 |
| `plan-*.json`／`prepared-*.json` | 本次切换计划及辅助进程准备确认 |
| `health-*.json` | 与本次令牌、PID、版本对应的启动结果 |
| `active.json`／`active-path.txt` | 已完成切换的版本及启动器使用的目录 key |
| `result.json` | 更新、回退、回退失败或旧进程未退出的状态 |

状态界面显示固定错误信息，不回显认证凭据或任意辅助进程错误文本。更新计划会保存本机原入口路径，不应把整个用户配置目录当公开诊断附件上传；面板诊断导出仍使用白名单。

## 当前验证范围

单元测试覆盖 Release／资产校验、路径和 ZIP 限制、冻结清单、文件变更、阶段保护及回退条件。7 个启动器测试实际运行 Windows WSH 的入口选择逻辑，最终创建应用的调用用记录器替换。`test:update-lifecycle` 使用真实 Node 子进程覆盖成功、新版失败恢复旧版、ready 后早崩回退、双方失败四种情况，并检查自有子进程退出。

上述更新测试不运行实际发行 EXE，不下载线上发行包，不接触游戏。另已用官方 Electron 验证源码版暂停启动、健康记录与正常退出。当前 0.4.1 正式 Release、本地最终包及远端 CI 尚待本轮收尾，具体状态见 [发布记录](RELEASE_0.4.1.md)。开发生成 ZIP 需要 Python 3.11+；便携包运行不需要 Node 或 Python。
