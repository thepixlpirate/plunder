const { app } = require('electron'); const path=require('path'), fs=require('fs'), os=require('os')
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(),'bv-')))
app.whenReady().then(async () => {
  const bv = require('../src/lib/bedrockVersions'); const store=require('../src/lib/store')
  const dst = path.join(store.P.base,'bedrock','v','1.21.120.4'); fs.mkdirSync(path.dirname(dst),{recursive:true}); fs.cpSync(process.argv[process.argv.length-1], dst, {recursive:true})
  bv.patchManifest(dst)
  console.log('[test] patched:\n'+fs.readFileSync(path.join(dst,'AppxManifest.xml'),'utf8'))
  console.log('[test] installed', JSON.stringify(bv.installed().map(v=>[v.id,v.kind,v.packageVersion])))
  try { await bv.available() } catch(e) { console.log('[test] available (offline):', e.message) }
  try { await bv.check() } catch(e) { console.log('[test] check:', e.message) }
  app.exit(0)
})
