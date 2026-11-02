# Overwolf 国服事件实验

记录日期：2026-11-02。实验与默认 Hexthon 进程隔离，代码位于 `experiments/overwolf-probe`。

## 本轮实际结果

已从官方 npm 安装 `@overwolf/ow-electron@44.9.0` 与 `@overwolf/ow-electron-packages-types@1.1.14`，从官方 `content.overwolf.com` 下载运行时。下载通过 npm 包内的 SHA-256 校验：`2c53bb73f53d2e216ee28800e35215618e3f2baea370679961e14bff13d70313`。未修改官方运行时、校验过程或授权检查。

2026-11-02 23:46（北京时间）实际后台运行探针，约 45 秒后正常退出：

| 阶段 | 实测结果 |
| --- | --- |
| OW-Electron 启动 | 成功，44.9.0，退出码 0 |
| 本应用创建的窗口 | 0；未注册托盘、快捷键或前台操作 |
| 开发凭据 | 本次进程未配置 |
| GEP 模块 ready | 未收到 |
| LoL 检测、feature 注册 | 尚未进入 |
| 候选／选中海克斯事件 | 未收到 |
| 国服兼容性 | **尚未验证**，不能从缺凭据的结果判断不兼容 |

结果分类为 `authorization-required`：这是由本地缺凭据、GEP 未就绪及官方开发要求得出的诊断，不冒称已收到服务端明确拒绝。探针没有截图或录像代码，只请求 `gep` 包，没有请求 `overlay` 或 `recorder`。第三方 GEP 自身的底层采集方式未验证。

诊断位于 `.qa/overwolf-probe/status.json` 和 `launch.json`，只保存阶段、数量、允许的几何／游戏字段、已解析名称及固定错误分类。SDK stdout/stderr 不落盘，不打印开发密钥。官方运行时自身的日志行为由其实现决定。探针结束后未发现本次运行的残留进程；原 API-only Hexthon 没有被替换或重启。

## 为什么 fork 示例不能代替 GEP 授权

官方示例和类型定义为 MIT，可以 fork 并保留许可后修改。类型声明描述了函数签名，没有实现 LoL 数据提取。npm 包包含安装器、启动器与声明，安装器另行下载预编译运行时。官方 FAQ 说明大部分 Overwolf Electron 扩展保持闭源。

- [示例 MIT 许可证](https://github.com/overwolf/ow-electron-packages-sample/blob/main/LICENSE)
- [类型 MIT 许可证](https://github.com/overwolf/ow-electron-packages-types/blob/main/LICENSE)
- [GEP 类型声明](https://github.com/overwolf/ow-electron-packages-types/blob/main/modules/gep.d.ts)
- [官方开源边界 FAQ](https://dev.overwolf.com/ow-electron/getting-started/onboarding-resources/ow-electron-faq/#q-why-is-it-closed-source)

官方 Dev Mode 要求有效的 `OW_DEV_KEY`，或 Developer Console 凭据。新开发者须先提交应用 idea，经人工批准后才能生成开发密钥；仅 fork 应用不改变这项运行条件。个人开发可以使用其受支持的开发模式，但仍需该凭据。[Dev Mode](https://dev.overwolf.com/ow-electron/guides/dev-tools/dev-mode/)

正式发布还有签名、QA 与产品要求。2026-11-01 起的新审批要求 Overwolf 广告或 Tebex 商业化；本项目没有加入广告、提交申请或代用户接受商业化安排。[发布要求](https://dev.overwolf.com/ow-electron/getting-started/release-your-app/)

## 已准备的代码

- 官方运行时隔离探针：只订阅 LoL `5426` 的 `augments` 与 `matchState`；PBE 不被当作国服证据。
- `src/core/gep-mayhem.cjs`：精确解析文档中的候选和最近一次选择，换局与退出隔离。`observedPicks` 只是观察到的历史，不冒充转化／替换后的完整当前构筑。
- `data/seed/gep-names.json`：从同一 16.21 补丁的 OP.GG 英中页面，按相同 ID、key、品质核对 263 对名称。未知或歧义保持未知，不模糊猜 ID。它不是国服事件实测结果。
- `diagnostics.cjs`：区分空字段通知、有效非空内容与完整三个已映射候选；空初始化通知不能把实验标成成功。

官方事件名是 `new-info-update` 与 `new-game-event`。候选事件只有显示名称，没有官方 augment ID。`picked_augment` 只给最近一项，没有完整历史或移除清单；也没有商店开关与卡片坐标。[LoL GEP 文档](https://dev.overwolf.com/ow-electron/live-game-data-gep/supported-games/league-of-legends/)

## 复现实验

```powershell
npm.cmd ci --prefix experiments/overwolf-probe
node experiments/overwolf-probe/node_modules/@overwolf/ow-electron/install.js
npm.cmd run probe:overwolf
# 有本机配置的有效开发密钥后，可增加观察时间：
npm.cmd run probe:overwolf -- --duration-ms=180000
```

凭据只在本机进程环境中配置，不提交仓库、不发到聊天。没有凭据也可运行诊断，但不应期待游戏事件。探针有运行上限，超时只清理本次仍存活的进程树，不按进程名结束其他程序。

后续只有在 GEP ready、LoL 检测与订阅成功后，才有意义验证腾讯国服真实选卡、重随、已选事件和性能。此路线作为可选数据适配器；当前主线采用可独立维护的 LCU / Live Client 与小区域视觉识别。
