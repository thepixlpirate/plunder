const { app } = require('electron'); const path=require('path'), fs=require('fs'), os=require('os')
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(),'rpo-')))
app.whenReady().then(async()=>{
  const instances=require('../src/lib/instances')
  const inst=await instances.create({edition:'java',name:'T',mc:'1.21.1',loader:'vanilla'})
  const gd=instances.gameDir(inst); const mk=(f,c='x')=>{fs.mkdirSync(path.dirname(path.join(gd,f)),{recursive:true});fs.writeFileSync(path.join(gd,f),c)}
  mk('resourcepacks/§f§lActually §6§l3D §fBlocks & Items!§7.zip'); mk('resourcepacks/§f§lActually §6§l3D §fBlocks & Items!§7.zip.rpo')
  mk('resourcepacks/Connected-Paths 26.2-26.3 v3.1.1.zip'); mk('resourcepacks/Connected-Paths 26.2-26.3 v3.1.1.zip.rpo')
  mk('resourcepacks/§6Bushier Bushes§r.zip.disabled'); mk('resourcepacks/FolderPack/pack.mcmeta')
  mk('shaderpacks/ComplementaryUnbound_r5.9.3.zip'); mk('shaderpacks/ComplementaryUnbound_r5.9.3.zip.txt')
  mk('mods/clumps.jar'); mk('mods/config.json'); mk('mods/.DS_Store')
  console.log('[test]\n'+instances.listContent(inst.id).map(i=>`${i.type.padEnd(13)} ${i.title}  (${i.file}, ${i.enabled?'on':'off'})`).join('\n'))
  app.exit(0)
})
