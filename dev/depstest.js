const { app } = require('electron'); const path=require('path'), fs=require('fs'), os=require('os')
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(),'deps-')))
const log=(...a)=>console.log('[test]',...a)
app.whenReady().then(async()=>{try{
  const AdmZip=require('adm-zip'), instances=require('../src/lib/instances')
  const inst=await instances.create({edition:'java',name:'T',mc:'1.21.1',loader:'vanilla'}); const i2=instances.get(inst.id); i2.loader='fabric'; instances.save(i2)
  const mods=path.join(instances.gameDir(inst),'mods'); fs.mkdirSync(mods,{recursive:true})
  const jar=(name,files)=>{const z=new AdmZip(); for(const [k,v] of Object.entries(files)) z.addFile(k, Buffer.isBuffer(v)?v:Buffer.from(typeof v==='string'?v:JSON.stringify(v))); return z}
  // Fabric API with a nested module
  const inner=jar('x',{'fabric.mod.json':{id:'fabric-api-base'}}).toBuffer()
  jar('',{'fabric.mod.json':{id:'fabric-api',name:'Fabric API',provides:['fabric'],jars:[{file:'META-INF/jars/base.jar'}]},'META-INF/jars/base.jar':inner}).writeZip(path.join(mods,'fabric-api.jar'))
  jar('',{'fabric.mod.json':'{\n // comment\n "id":"sodium","name":"Sodium","depends":{"fabric-api-base":"*","minecraft":"1.21.1"},"breaks":{"optifabric":"*"},}'}).writeZip(path.join(mods,'sodium.jar'))
  jar('',{'fabric.mod.json':{id:'reeses',name:"Reese's Sodium Options",depends:{sodium:'*','cloth-config':'*'}}}).writeZip(path.join(mods,'reeses.jar'))
  jar('',{'fabric.mod.json':{id:'optifabric',name:'OptiFabric'}}).writeZip(path.join(mods,'optifabric.jar'))
  jar('',{'META-INF/mods.toml':'modLoader="javafml"\n[[mods]]\nmodId="create"\ndisplayName="Create"\n[[dependencies.create]]\nmodId="flywheel"\nmandatory=true\n[[dependencies.create]]\nmodId="jei"\nmandatory=false\n'}).writeZip(path.join(mods,'create.jar'))
  fs.writeFileSync(path.join(mods,'broken.jar'),'not a zip')
  const r=require('../src/lib/modinfo').check(inst.id); log(JSON.stringify(r))
  // crash report
  const cr=path.join(instances.gameDir(inst),'crash-reports'); fs.mkdirSync(cr,{recursive:true})
  fs.writeFileSync(path.join(cr,'crash-2026.txt'),`---- Minecraft Crash Report ----\nDescription: Rendering overlay\n\njava.lang.NullPointerException: Cannot invoke "foo"\n\tat me.jellysquid.mods.sodium.client.render.Thing.render(Thing.java:10)\n\tat net.minecraft.client.Main.run(Main.java:1)\n\nA detailed walkthrough...\nSuspected Mods: Sodium (sodium)\nStacktrace:\n`)
  const a=require('../src/lib/crash').analyze(inst.id,0); log('crash:', JSON.stringify({summary:a.summary,fix:a.fix,suspects:a.suspects,detail:a.detail}))
  fs.writeFileSync(path.join(cr,'crash-2026.txt'),'java.lang.OutOfMemoryError: Java heap space'); log('oom:', require('../src/lib/crash').analyze(inst.id,0).summary)
}catch(e){log('FAIL',e.stack)} app.exit(0)})
