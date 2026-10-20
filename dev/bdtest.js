const { app } = require('electron'); const path=require('path'), fs=require('fs'), os=require('os')
const T = fs.mkdtempSync(path.join(os.tmpdir(),'bd-')); process.env.APPDATA = path.join(T,'Roaming')
app.setPath('userData', path.join(T,'pl'))
const log=(...a)=>console.log('[test]',...a)
const mk=(p,c='x')=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,c)}
const ls=d=>{try{return fs.readdirSync(d).join(',')}catch{return '(none)'}}
app.whenReady().then(async()=>{
  try{
  const live=path.join(process.env.APPDATA,'Minecraft Bedrock'), W=p=>path.join(p,'Users','123','games','com.mojang','minecraftWorlds')
  mk(path.join(W(live),'My Real World','level.dat'))
  const instances=require('../src/lib/instances'), bd=require('../src/lib/bedrockData')
  const shared=await instances.create({edition:'bedrock',name:'Shared'})
  const iso=await instances.create({edition:'bedrock',name:'Modded',bedrockIsolated:true})
  bd.activate(iso); log('after iso activate: live is link?', fs.lstatSync(live).isSymbolicLink(), '| roaming:', ls(process.env.APPDATA), '| live worlds:', ls(W(live)))
  mk(path.join(W(live),'Modded World','level.dat'))
  log('profile folder worlds:', ls(W(bd.profileDir(iso))))
  bd.activate(shared); log('after shared: link?', fs.lstatSync(live).isSymbolicLink(), '| roaming:', ls(process.env.APPDATA), '| worlds:', ls(W(live)))
  bd.activate(iso); await bd.copySharedInto(iso); log('after copy into iso, live worlds:', ls(W(live)))
  // simulate crash: link present, then repair with target deleted
  log('status', JSON.stringify(bd.status(iso)))
  instances.remove(iso.id); log('after deleting iso profile: roaming:', ls(process.env.APPDATA), 'link?', fs.lstatSync(live).isSymbolicLink(), 'worlds:', ls(W(live)))
  // crash scenario: stash exists & live missing
  fs.renameSync(live, live+' (Plunder shared)'); bd.repair(); log('after repair of half-done:', ls(process.env.APPDATA))
  // conflict scenario
  const iso2=await instances.create({edition:'bedrock',name:'Two',bedrockIsolated:true}); fs.mkdirSync(live+' (Plunder shared)')
  try{ bd.activate(iso2) }catch(e){ log('conflict ->', e.message.slice(0,60)) }
  fs.rmdirSync(live+' (Plunder shared)')
  bd.activate(iso2); bd.restoreAllOnQuit(); log('after quit restore:', ls(process.env.APPDATA), 'link?', fs.lstatSync(live).isSymbolicLink(), 'worlds:', ls(W(live)))
  }catch(e){log('FAIL',e.stack)}
  app.exit(0)
})
