# Hexthon · 海克斯大乱斗外置助手

Windows 桌面开发原型，以 **OP.GG 海克斯大乱斗公开页面**为资料源，面向国服客户端适配。提供独立透明浮层、英雄专属强化符文档位、出装参考、手动三选一比较和本地中文 OCR。

## 使用

已打包版本位于 `dist/Hexthon-win32-x64/Hexthon.exe`。保留整个文件夹，不要只移动 exe。

启动后默认停留在系统托盘。点击 Hexthon 的 H 图标打开控制面板；也可以按 **Ctrl + Alt + H**。关闭面板后程序继续运行，通过托盘菜单退出。

1. 在面板查阅英雄，或开启「跟随游戏英雄」。未连接游戏时，默认查阅九尾妖狐，界面明确显示为手动查阅。
2. 游戏显示模式设为**无边框**或**窗口模式**。进入识别到的海克斯大乱斗后，默认显示浮层。
3. 在游戏里按 **Ctrl + Alt + S** 读取当前卡片名称；也可在面板选择三个符文进行比较。
4. 按 **Ctrl + Alt + O** 显示／隐藏浮层。浮层始终鼠标穿透，不接受键盘焦点。显示器、位置与透明度在「连接与浮层」中设置。

| 快捷键 | 功能 |
| --- | --- |
| Ctrl + Alt + H | 打开控制面板，不主动激活窗口 |
| Ctrl + Alt + O | 显示／隐藏只读浮层 |
| Ctrl + Alt + S | 识别海克斯大乱斗游戏窗口 |

快捷键注册失败时，设置页会提示，可使用托盘菜单。当前浮层固定在所选显示器一角；不会自动跟随游戏窗口移动，Alt-Tab 时可用快捷键隐藏。

## 当前功能与边界

- OP.GG 中文英雄列表、强化符文说明、品质、英雄专属档位、出门装、鞋子及核心装备。
- 资料缓存 6 小时有效，访问失败时保留旧数据并提示。附获取时间、补丁版本和原页面入口。
- 随包提供 2026-11-02 获取的 16.21 页面快照：173 个英雄、263 个完整的通用符文条目，以及阿狸的 209 个专属符文条目和出装。其他英雄按需请求，成功后缓存。
- 档位以原始数字表示为 T0–T5。**没有把 OP.GG 内部 `performance`、`popular` 字段改写成胜率或选取率**，也不补造样本量。
- 国服本地读取适配：发现 LeagueClient 的进程启动参数或 `lockfile`，读取 LCU 的阶段、队列、选人英雄；游戏内使用 `127.0.0.1:2999` 的 Live Client Data API。
- 优先使用 Windows 自带的中文 OCR；没有中文识别组件时回退 Tesseract 中文模型，首次下载约 1.7 MB。可导入一张完整游戏窗口截图；区域参数按游戏窗口百分比计算。
- OCR 模糊匹配标为待确认；只有恰好三个无歧义的名称匹配才填入比较栏。它们仍是待玩家核对的名称，不是游戏 API 确认的选项。
- 自动 OCR 为实验功能，默认关闭，可在设置中开启每 12 秒尝试读取一次。

OP.GG 数据不代表国服对局统计。LCU 是 Riot 未承诺支持的本地接口，国服发行版本、权限和补丁可能影响可用性。未识别到队列时可以手动确认本局模式；结束对局后重置。普通 ARAM 不会直接当成海克斯模式。

## 国服连接排查

1. 打开英雄联盟客户端，再查看「连接与浮层」里的 LCU / Live Client 状态。
2. 如果 LCU 未连接，填写实际 `lockfile` 路径，例如 `D:\WeGameApps\英雄联盟\LeagueClient\lockfile`，或其所在目录。示例路径不代表你的安装位置。
3. Live Client 只在实际对局中可用。客户端首页显示未连接是正常的。
4. 如果只有 Live Client 可用，英雄仍可以识别；队列未知时需要手动确认本局海克斯模式。
5. OCR 找不到游戏窗口或读到黑屏时，先检查无边框模式。也可导入游戏截图，调整中央识别区域后再试。

程序不启动游戏、不提交游戏操作、不安装驱动、不修改客户端文件。LCU 凭据只保留在主进程内存中，发送给固定回环地址；不写入日志或传给界面。对本地自签名证书的例外仅限这几个回环 GET 请求，外部 HTTPS 验证保持开启。

## 开发

要求：Windows 10/11 x64，Node.js 22.12+；当前验证环境 Node 24。

```powershell
npm.cmd ci
npm.cmd start                 # 托盘启动
npm.cmd run start:panel       # 打开控制面板
npm.cmd test                 # 数据、匹配、连接解析、边界测试
npm.cmd run test:ui           # 隐藏 Electron 窗口的界面冒烟测试
npm.cmd run test:ui -- --with-ocr  # 加测本地中文 OCR，原生识别不可用时下载备用模型
npm.cmd run sync             # 从 OP.GG 更新内置资料快照
node scripts/cache-assets.cjs # 更新内置图标缓存
npm.cmd run package          # 输出 Windows 可运行目录
```

`package` 默认不覆盖已有同名输出。再次打包时应使用新的输出目录，或由开发者确认后移走旧包。

设置与运行缓存位于 `%APPDATA%\Hexthon`。界面测试使用独立 `.qa/profile`，不改正式设置；截图和测试报告写入 `.qa`，窗口保持隐藏，不移动鼠标或发送系统键盘输入。

## 代码位置

| 位置 | 内容 |
| --- | --- |
| `src/main.cjs` | Electron 生命周期、托盘、浮层、状态协调与 IPC |
| `src/core/opgg.cjs` | 公开页面获取、惰性 JSON 解析、缓存与失败退避 |
| `src/core/league.cjs` | 国服客户端发现、LCU 和 Live Client 只读接口 |
| `src/core/ocr.cjs`、`src/native/ocr.ps1` | Windows 原生中文 OCR，Tesseract 备用引擎 |
| `src/core/matching.cjs` | 名称标准化与保守模糊匹配 |
| `src/renderer` | 控制面板与透明浮层 |
| `data/seed` | 附来源、时间和补丁的真实页面快照 |
| `docs/RESEARCH.md` | 已有项目对比、信息获取渠道和方案取舍 |

当前版本需要真实国服海克斯对局验证连接、OCR 区域、快捷键及窗口叠加行为。隐藏窗口测试和合成文字图片测试不能替代实局验证。

本机的 Windows 中文 OCR 已通过三条合成名称测试。备用 Tesseract 对同一测试中的「魔法飞弹」存在误读，因此无原生中文识别组件时，需更频繁地手动核对结果。Windows OCR 使用的裁剪图片暂存于本地缓存目录，调用完成后删除。

## 来源与第三方声明

资料来自 [OP.GG 海克斯大乱斗](https://op.gg/zh-cn/lol/modes/aram-mayhem)，游戏内容与图片属于各自权利人。公开页面解析不是 OP.GG 承诺稳定的开放 API。本项目未公开发布；计划公开分发前，需要单独确认数据使用授权以及 Riot／腾讯当前第三方应用要求。依赖见 `THIRD_PARTY_NOTICES.md`。

Hexthon isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.
