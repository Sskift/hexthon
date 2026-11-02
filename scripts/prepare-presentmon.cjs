// Downloads the official portable console only; no installer, service, driver,
// elevation, registry change, or capture is run here.
const path = require('node:path');
const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');
const VERSION = '2.6.0';
const FILE = `PresentMon-${VERSION}-x64.exe`;
const SHA256 = 'b2a706bc6ad475749e3b7e3409263aa1e6906d45bdcf993f6dbc0f660188f1af';
const URL = `https://github.com/GameTechDev/PresentMon/releases/download/v${VERSION}/${FILE}`;
const DIRECTORY = path.resolve(__dirname, '../.research/presentmon');
const EXECUTABLE = path.join(DIRECTORY, FILE);
const checksum = bytes => createHash('sha256').update(bytes).digest('hex');
async function download(url, limit) {
  const response = await fetch(url, { signal: AbortSignal.timeout(25000), headers: { 'User-Agent': 'Hexthon-diagnostics' } });
  if (!response.ok) throw new Error('PRESENTMON_DOWNLOAD_FAILED');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > limit) throw new Error('PRESENTMON_DOWNLOAD_LIMIT'); chunks.push(Buffer.from(chunk)); }
  return Buffer.concat(chunks);
}
async function verifyTool() {
  try { const bytes = await fs.readFile(EXECUTABLE); return bytes.length === 980320 && checksum(bytes) === SHA256; } catch { return false; }
}
async function prepare() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('PRESENTMON_REQUIRES_WINDOWS_X64');
  await fs.mkdir(DIRECTORY, { recursive: true });
  if (!await verifyTool()) {
    const bytes = await download(URL, 2 * 1024 * 1024);
    if (bytes.length !== 980320 || checksum(bytes) !== SHA256) throw new Error('PRESENTMON_CHECKSUM_MISMATCH');
    await fs.writeFile(EXECUTABLE + '.tmp', bytes); await fs.rename(EXECUTABLE + '.tmp', EXECUTABLE);
  }
  const readme = (await download(`https://raw.githubusercontent.com/GameTechDev/PresentMon/v${VERSION}/README.md`, 100000)).toString('utf8');
  const license = readme.match(/## License\s+([\s\S]*?)(?=\n## )/i)?.[1];
  if (!license?.includes('Permission is hereby granted')) throw new Error('PRESENTMON_LICENSE_UNAVAILABLE');
  await fs.writeFile(path.join(DIRECTORY, 'LICENSE-PresentMon.txt'), license.trim() + '\n');
  await fs.writeFile(path.join(DIRECTORY, 'source.json'), JSON.stringify({ version: VERSION, url: URL, sha256: SHA256,
    source: `https://github.com/GameTechDev/PresentMon/releases/tag/v${VERSION}`, portableConsoleOnly: true }, null, 2));
  return { ready: true, version: VERSION, sha256Verified: true, portableConsoleOnly: true, captureStarted: false };
}
if (require.main === module) prepare().then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { VERSION, EXECUTABLE, SHA256, verifyTool, prepare };
