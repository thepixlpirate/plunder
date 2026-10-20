const { app } = require('electron'); const path=require('path'), fs=require('fs'), os=require('os')
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(),'psc-')))
const OUT = process.argv[process.argv.length-1]; fs.mkdirSync(OUT,{recursive:true})
const cp = require('child_process'); let n=0
const grab = args => { const i=args.indexOf('-File'); if (i>=0) fs.copyFileSync(args[i+1], path.join(OUT, `s${++n}.ps1`)); const c=args.indexOf('-Command'); if(c>=0) fs.writeFileSync(path.join(OUT,`s${++n}-launcher.ps1`), args[c+1]) }
cp.execFile = (f,args,opts,cb) => { grab(args); const json = JSON.stringify({devMode:true,gamingServices:true,minecraft:[{name:'Microsoft.MinecraftUWP',version:'1.21.120.4',dev:false,location:'C:\\XboxGames\\Minecraft\\Content'}]}); setImmediate(()=>cb(null, json, '')); return {} }
cp.spawn = (f,args) => { grab(args); const m=args[args.length-1].match(/'-File','"([^"]+)"'/); if (m) fs.copyFileSync(m[1], path.join(OUT,`s${++n}-elevated.ps1`)); const EE=require('events'); const e=new EE(); setTimeout(()=>e.emit('exit',1),50); e.unref=()=>{}; return e }
Object.defineProperty(process,'platform',{value:'win32'})
app.whenReady().then(async () => {
  const net=require('../src/lib/net'); net.download = async (u,d)=>{fs.mkdirSync(path.dirname(d),{recursive:true});fs.writeFileSync(d,'x')}; net.getJson = async ()=>({release:{'1.21.120.4':['http://x/MICROSOFT.MINECRAFTUWP_1.21.12004.0_x64__8wekyb3d8bbwe.msixvc']},preview:{}})
  const bv=require('../src/lib/bedrockVersions'); const store=require('../src/lib/store')
  await bv.check()
  try { await bv.install({version:'1.21.120.4',kind:'release'}) } catch(e){ console.log('[test] install ->', e.message) }
  const dst=path.join(store.P.base,'bedrock','v','1.21.120.4'); fs.cpSync(process.env.MF, dst, {recursive:true})
  try { await bv.activate('1.21.120.4') } catch(e){ console.log('[test] activate ->', e.message) }
  try { await bv.restoreStore('release') } catch(e){ console.log('[test] restore ->', e.message) }
  try { await bv.remove('1.21.120.4') } catch(e){ console.log('[test] remove ->', e.message) }
  console.log('[test] captured', fs.readdirSync(OUT).join(' ')); app.exit(0)
})
