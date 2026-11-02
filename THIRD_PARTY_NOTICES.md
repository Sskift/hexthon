# 第三方声明

Hexthon v0.2 的公开源码位于 [Sskift/hexthon](https://github.com/Sskift/hexthon)。项目使用的依赖、游戏内容和数据保留各自权利及许可。

## 运行依赖

- [Electron](https://github.com/electron/electron)：MIT。发行包还包含 Chromium 等组件，应保留随包 `LICENSE`、`LICENSES.chromium.html` 及其他原有许可文件。
- [Cheerio](https://github.com/cheeriojs/cheerio)：MIT。
- [Tesseract.js](https://github.com/naptha/tesseract.js)：Apache-2.0，使用 Tesseract.js-core。备用中文模型从固定版本的 `@tesseract.js-data/chi_sim` 包通过 jsDelivr 获取；具体许可见对应包与 [Tesseract trained data](https://github.com/tesseract-ocr/tessdata)。模型用于本地识别，不上传截图。
- Windows.Media.Ocr：通过系统已安装的 Windows 运行时调用。Win32 窗口状态读取及原生 OCR 辅助进程不改变这些组件的许可。

## 数据与游戏内容

- [OP.GG 海克斯大乱斗公开页面](https://op.gg/zh-cn/lol/modes/aram-mayhem)：用于英雄综合排名、符文档位、名称、说明、出装与图标。保留来源 URL、获取时间和补丁信息。公开页面解析不代表 OP.GG 承诺提供稳定开放 API。
- [Riot Data Dragon](https://developer.riotgames.com/docs/lol#data-dragon)：用于英雄职业与基础属性、装备属性和合成关系。归一化文件 `data/static/riot.json` 保留官方来源与版本，不把该数据解释为表现统计。
- 游戏文字、统计数据、角色和图标等内容不因源码公开而获得本项目源码许可，相关权利仍属于各自权利人。图标缓存的来源映射保存在 `assets/manifest.json`。

Hexthon 未获得 Riot Games、腾讯或 OP.GG 的背书。

## 架构参考

以下项目仅用于参考公开架构与工作流，没有将其业务源码复制进本项目：

- [Sygnano/aram-mayhem-tracker](https://github.com/Sygnano/aram-mayhem-tracker)
- [CyberKird/aram-mayhem-helper](https://github.com/CyberKird/aram-mayhem-helper)
- [zp96-cmd/mayhem-overlay](https://github.com/zp96-cmd/mayhem-overlay)

依赖许可保留在 `node_modules` 与打包应用的对应组件中。`.qa`、本机配置和诊断文件不是第三方素材，也不随源码或发行包分发。

Hexthon isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.
