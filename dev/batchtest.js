const { app } = require('electron'); const path=require('path'), fs=require('fs'), os=require('os'), zlib=require('zlib')
const T=fs.mkdtempSync(path.join(os.tmpdir(),'bt-')); app.setPath('userData', T)
const log=(...a)=>console.log('[test]',...a)
function png(w,h){ // minimal valid RGBA png
  const crc=b=>{let c,t=[];for(let n=0;n<256;n++){c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0}let x=0xffffffff;for(const v of b)x=t[(x^v)&255]^(x>>>8);return (x^0xffffffff)>>>0}
  const chunk=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([l,td,c])}
  const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=6
  const raw=Buffer.alloc((w*4+1)*h); return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ih),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))])}
app.whenReady().then(async()=>{try{
  const net=require('../src/lib/net'); net.getJson=async()=>{throw new Error('offline')}
  const instances=require('../src/lib/instances'), store=require('../src/lib/store')
  const inst=await instances.create({edition:'java',name:'Pack Test',mc:'1.21.1',loader:'vanilla'})
  const gd=instances.gameDir(inst); const mk=(f,c='x')=>{fs.mkdirSync(path.dirname(path.join(gd,f)),{recursive:true});fs.writeFileSync(path.join(gd,f),c)}
  mk('mods/a.jar','AAA'); mk('mods/b.jar.disabled','B'); mk('resourcepacks/p.zip','P'); mk('resourcepacks/p.zip.rpo','R'); mk('config/sodium.json','{}'); mk('options.txt','fov:90'); mk('saves/W/level.dat','L'); mk('saves/W/stats/u.json',JSON.stringify({stats:{'minecraft:custom':{'minecraft:play_time':72000}}}))
  // export
  const out=path.join(T,'out.mrpack'); const r=await require('../src/lib/packexport').exportPack(inst.id,out,{includeWorlds:true})
  const AdmZip=require('adm-zip'); log('export:', JSON.stringify(r), '| entries:', new AdmZip(out).getEntries().map(e=>e.entryName).sort().join(', '))
  // import the exported pack
  const imp=await require('../src/lib/content').installModpack({file:out}); const g2=instances.gameDir(imp.instance)
  log('import:', imp.instance.name, imp.instance.mc, imp.instance.loader, '| mods:', fs.readdirSync(path.join(g2,'mods')).join(','), '| options:', fs.readFileSync(path.join(g2,'options.txt'),'utf8'), '| worlds:', fs.readdirSync(path.join(g2,'saves')).join(','))
  // auto backups
  const worlds=require('../src/lib/worlds')
  log('auto1', JSON.stringify(await worlds.autoBackup({edition:'java',instanceId:inst.id})))
  log('auto2 (unchanged, daily)', JSON.stringify(await worlds.autoBackup({edition:'java',instanceId:inst.id})))
  store.get().settings.autoBackup='launch'; store.get().settings.autoBackupKeep=2
  for (let i=0;i<3;i++){ await new Promise(r=>setTimeout(r,1100)); fs.utimesSync(path.join(gd,'saves/W/level.dat'),new Date(),new Date()); await worlds.autoBackup({edition:'java',instanceId:inst.id}) }
  log('backups kept:', worlds.listBackups('java',inst.id,'W').map(b=>b.file).join(', '))
  log('world playtime s:', worlds.javaWorlds(inst.id)[0].playSeconds)
  // updater compare
  const up=require('../src/lib/updater'); log('cmp', up.cmp('1.7.0','1.6.1')>0, up.cmp('v1.6.1','1.6.1')===0, up.cmp('1.10.0','1.9.9')>0)
  store.get().settings.updateRepo=''; log('update not configured:', JSON.stringify(await up.check()))
  // skins
  const sk=require('../src/lib/skins'); fs.writeFileSync(path.join(T,'steve.png'),png(64,64)); fs.writeFileSync(path.join(T,'bad.png'),png(32,32))
  sk.addFile(path.join(T,'steve.png'),'slim'); try{sk.addFile(path.join(T,'bad.png'))}catch(e){log('bad skin ->',e.message)}
  log('skins:', sk.list().map(s=>s.name+'/'+s.variant).join(','))
  // stats session
  store.addSession({instanceId:inst.id,edition:'java',start:Date.now()-600000,ms:600000}); store.addSession({instanceId:inst.id,edition:'java',start:Date.now(),ms:5000}); log('sessions:', store.get().sessions.length)
  // quick settings update allowed
  instances.update(inst.id,{fullscreen:true,width:1920,height:1080}); const q=instances.get(inst.id); log('quick:', q.fullscreen,q.width,q.height)
}catch(e){log('FAIL',e.stack)} app.exit(0)})
