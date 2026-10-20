const { app } = require('electron'); const path=require('path'), fs=require('fs'), os=require('os'), crypto=require('crypto')
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(),'upd-')))
const log=(...a)=>console.log('[test]',...a)
app.whenReady().then(async()=>{try{
  const net=require('../src/lib/net'); const sha=b=>crypto.createHash('sha1').update(b).digest('hex')
  const instances=require('../src/lib/instances')
  const inst=await instances.create({edition:'java',name:'T',mc:'1.21.1',loader:'vanilla'})
  const gd=instances.gameDir(inst); fs.mkdirSync(path.join(gd,'resourcepacks'),{recursive:true})
  fs.writeFileSync(path.join(gd,'resourcepacks','Faithful-1.0.zip'),'old1'); fs.writeFileSync(path.join(gd,'resourcepacks','Fresh-2.0.zip.disabled'),'old2'); fs.writeFileSync(path.join(gd,'resourcepacks','Current.zip'),'same')
  instances.recordContent(inst.id,'resourcepacks/Faithful-1.0.zip',{source:'modrinth',projectId:'FAITH',title:'Faithful',versionName:'1.0'})
  let body
  net.getJson=async(url,opts)=>{ body=opts.body; return { [sha('old1')]:{id:'v2',project_id:'FAITH',version_number:'1.1',files:[{primary:true,url:'http://x/Faithful-1.1.zip',filename:'Faithful-1.1.zip',hashes:{sha1:sha('new1')}}]}, [sha('old2')]:{id:'v9',project_id:'FRESH',version_number:'2.1',files:[{primary:true,url:'http://x/Fresh-2.1.zip',filename:'Fresh-2.1.zip',hashes:{sha1:sha('new2')}}]}, [sha('same')]:{id:'v1',project_id:'CUR',version_number:'1',files:[{primary:true,url:'u',filename:'Current.zip',hashes:{sha1:sha('same')}}]} } }
  net.download=async(url,dest)=>{ fs.writeFileSync(dest, url.includes('Faithful')?'new1':'new2') }
  const upd=require('../src/lib/updates')
  const r=await upd.check(inst.id); log('loaders sent', JSON.stringify(body.loaders), 'mc', body.game_versions)
  log('updates found:', Object.entries(r.updates).map(([k,v])=>k+' -> '+v.versionName).join(' | '))
  await upd.updateOne(inst.id,'resourcepacks/Faithful-1.0.zip'); log('after one:', fs.readdirSync(path.join(gd,'resourcepacks')).join(', '))
  log('meta:', JSON.stringify(instances.get(inst.id).content))
  const a=await upd.updateAll(inst.id); log('update all:', JSON.stringify(a), '|', fs.readdirSync(path.join(gd,'resourcepacks')).join(', '))
  log('list urls:', instances.listContent(inst.id).map(i=>i.title+'='+i.url).join(' | '))
}catch(e){log('FAIL',e.stack)} app.exit(0)})
