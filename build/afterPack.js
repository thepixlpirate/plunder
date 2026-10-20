// electron-builder hook: brand the app exe before it's wrapped into the single portable Plunder.exe.
const path = require('path')
exports.default = async function (ctx) {
  if (ctx.electronPlatformName !== 'win32') return
  const exe = path.join(ctx.appOutDir, ctx.packager.appInfo.productFilename + '.exe')
  const { setIcon } = await import('./seticon.mjs')
  setIcon(exe, path.join(__dirname, 'icon.ico'))
  console.log('  • branded', path.basename(exe))
}
