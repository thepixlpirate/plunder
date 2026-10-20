// Reads the newest crash report / game log and explains in plain words what probably went wrong.
const fs = require('fs')
const path = require('path')
const instances = require('./instances')
const modinfo = require('./modinfo')

function newest (dir, filter, since = 0) {
  if (!fs.existsSync(dir)) return null
  const files = fs.readdirSync(dir).filter(filter).map(f => ({ f: path.join(dir, f), t: fs.statSync(path.join(dir, f)).mtimeMs })).filter(x => x.t >= since).sort((a, b) => b.t - a.t)
  return files[0] ? files[0].f : null
}

function analyze (instanceId, since = 0, liveLog = '') {
  const inst = instances.get(instanceId)
  const gd = instances.gameDir(inst)
  const report = newest(path.join(gd, 'crash-reports'), f => /\.txt$/i.test(f), since)
  const logFile = path.join(gd, 'logs', 'latest.log')
  let text = ''
  let file = null
  if (report) { text = fs.readFileSync(report, 'utf8'); file = report }
  else if (fs.existsSync(logFile) && fs.statSync(logFile).mtimeMs >= since) { text = fs.readFileSync(logFile, 'utf8').slice(-200000); file = logFile }
  if (liveLog) text += '\n' + liveLog.slice(-100000)
  if (!text.trim()) return null

  const mods = inst.edition === 'java' ? modinfo.scan(instanceId) : []
  const byId = id => mods.find(m => m.id === id || m.provides.includes(id))
  const suspects = new Map()
  const addSuspect = (id, why) => {
    const m = byId(id)
    if (!m || ['minecraft', 'java', 'fabricloader', 'forge', 'neoforge'].includes(id)) return
    if (!suspects.has(m.fileName)) suspects.set(m.fileName, { id: m.id, name: m.name || m.id, file: m.fileName, why })
  }
  const found = []
  let summary = null, fix = null

  // ---- Common, well-known causes ----
  if (/java\.lang\.OutOfMemoryError|GC overhead limit exceeded/i.test(text)) {
    summary = 'Minecraft ran out of memory.'
    fix = 'Give this instance more RAM in its Settings tab (6–8 GB for big modpacks).'
  } else if (/Could not reserve enough space for .*object heap|Invalid maximum heap size/i.test(text)) {
    summary = "Minecraft couldn't get the amount of memory it was given."
    fix = 'Lower the RAM for this instance in its Settings tab.'
  } else if (/UnsupportedClassVersionError|has been compiled by a more recent version of the Java Runtime/i.test(text)) {
    summary = 'A mod needs a newer Java than this Minecraft version uses.'
    fix = 'One of the mods is made for a newer Minecraft version. Check the mods listed below and get the version for your Minecraft.'
  } else if (/Incompatible mods? found|Mod resolution failed|requires (?:any version|version) .*? of (?:mod )?['"]?[\w-]+|which is missing!/i.test(text)) {
    summary = "Some mods are missing other mods they need, or don't work together."
    fix = 'Install the missing mods (Plunder lists them on the Content tab), or remove the mod that needs them.'
  } else if (/Mixin (?:apply|transformation) .*failed|MixinApplyError|InvalidMixinException/i.test(text)) {
    summary = 'A mod failed to load into the game (a “mixin” error) — usually two mods clashing or a mod made for another Minecraft version.'
  } else if (/GLFW error|OpenGL|Pixel format not accelerated|No OpenGL context|WGL: The driver does not appear to support OpenGL/i.test(text)) {
    summary = "Your graphics driver couldn't start the game."
    fix = 'Update your graphics driver (NVIDIA/AMD/Intel website). Shader mods can also cause this.'
  } else if (/Failed to (?:verify|authenticate) .*|Invalid session|401 Unauthorized/i.test(text)) {
    summary = 'Your sign-in was rejected.'
    fix = 'Remove your account in Settings and sign in again.'
  } else if (/ClassNotFoundException|NoClassDefFoundError|NoSuchMethodError|NoSuchFieldError/i.test(text)) {
    summary = 'A mod is trying to use something that isn’t there — usually a mod for a different Minecraft or mod loader version, or a missing required mod.'
  }

  // ---- Who's to blame ----
  // Fabric/Forge crash reports list suspects directly.
  const susBlock = text.match(/Suspected Mods?:\s*([\s\S]*?)(?:\n\s*\n|Stacktrace:)/i)
  if (susBlock) for (const m of susBlock[1].matchAll(/\(([\w.-]+)\)/g)) addSuspect(m[1], 'Named in the crash report')
  for (const m of text.matchAll(/Mod ['"]?([^'"\n(]+?)['"]? \(([\w.-]+)\) [\d.\w+-]* requires/gi)) addSuspect(m[2], 'Needs a mod that is missing')
  for (const m of text.matchAll(/(?:from mod|mixin config|in mod) ['"]?([\w.-]+)['"]?/gi)) addSuspect(m[1].replace(/\.mixins?.*$/i, ''), 'Mentioned in the error')
  for (const m of text.matchAll(/at\s+([\w$.]+)\(/g)) {
    if (suspects.size >= 5) break
    const pkg = m[1].toLowerCase()
    if (/^(java|jdk|sun|net\.minecraft|com\.mojang|org\.lwjgl|net\.fabricmc\.loader|cpw|net\.minecraftforge|net\.neoforged|org\.spongepowered|com\.google|it\.unimi|io\.netty|org\.apache)\./.test(pkg)) continue
    const mod = mods.find(x => x.id && x.id.length > 3 && pkg.includes(x.id.replace(/[-_]/g, '').toLowerCase()))
    if (mod) addSuspect(mod.id, 'Appears in the error details')
  }
  const desc = (text.match(/Description:\s*(.+)/) || [])[1]
  const exc = (text.match(/^((?:[\w$]+\.)+[\w$]*(?:Exception|Error)[^\n]*)/m) || [])[1]
  if (!summary) summary = desc ? `The game crashed: “${desc.trim()}”.` : 'The game closed unexpectedly.'
  if (!fix && suspects.size) fix = 'Try turning off the mod(s) below, then play again. If that fixes it, look for an update for that mod.'
  if (!fix) fix = 'Open the crash report for the full details, or check the Log tab.'
  const deps = inst.edition === 'java' && inst.loader !== 'vanilla' ? modinfo.check(instanceId) : null
  return { summary, fix, suspects: [...suspects.values()].slice(0, 5), detail: exc || desc || '', file, deps }
}

module.exports = { analyze }
