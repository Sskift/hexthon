# Third-party notices

This local development prototype includes or uses:

- [Electron](https://github.com/electron/electron), MIT. Its distribution also contains Chromium and other components with their included licenses; keep the bundled `LICENSE` and `LICENSES.chromium.html` files.
- [Cheerio](https://github.com/cheeriojs/cheerio), MIT.
- [Tesseract.js](https://github.com/naptha/tesseract.js), Apache-2.0, and its dependency Tesseract.js-core. The fallback Chinese model is downloaded from the versioned `@tesseract.js-data/chi_sim` package via jsDelivr. See the respective packages and [Tesseract trained data](https://github.com/tesseract-ocr/tessdata) for licenses. Windows.Media.Ocr is used through the installed Windows runtime when available.
- [OP.GG](https://op.gg/zh-cn/lol/modes/aram-mayhem) public page data and images. Source URLs, retrieval times and patch information are retained. Statistics, game text and images are not licensed under this project's source code. All rights remain with their respective owners.
- Riot Games game content. Hexthon is not endorsed by Riot Games, Tencent or OP.GG.

The following projects were consulted for architecture and workflow only. Their source code was not copied into this project:

- https://github.com/Sygnano/aram-mayhem-tracker
- https://github.com/CyberKird/aram-mayhem-helper
- https://github.com/zp96-cmd/mayhem-overlay

Dependencies retain their original license files in `node_modules` and the packaged application. The asset manifest maps cached icons to their original OP.GG URLs.
