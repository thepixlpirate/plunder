// Fake backend for previewing the UI in a plain browser.
(() => {
  const now = Date.now(), d = 86400000
  const inst = [
    { id: 'a1', edition: 'java', name: 'Vanilla Survival', mc: '1.21.10', loader: 'vanilla', seed: 11, playTime: 41*3600e3, lastPlayed: now - 2*d, created: now - 30*d, content: {} },
    { id: 'a2', edition: 'java', name: 'Fabric Optimized', mc: '1.21.1', loader: 'fabric', playTime: 18*3600e3, loaderVersion: '0.16.9', seed: 22, lastPlayed: now - 5*d, created: now - 20*d, content: { 'mods/sodium.jar': { source: 'modrinth', projectId: 'AANobbMI', title: 'Sodium' } } },
    { id: 'a3', edition: 'java', name: 'Create Adventures', mc: '1.20.1', loader: 'forge', playTime: 7*3600e3, loaderVersion: '0.27.1', seed: 33, lastPlayed: now - 9*d, created: now - 10*d, content: {}, modpack: {} },
    { id: 'b1', edition: 'bedrock', name: 'My Bedrock', bedrockVersion: '1.21.50.7', seed: 44, lastPlayed: now - 14*d, addons: [{ file: 'furniture.mcaddon', title: 'Furniture Add-on', added: now - 3*d }], servers: [{ name: 'Friends Server', host: 'play.example.com', port: 19132 }] }
  ]
  const state = { settings: { curseforgeKey: '', memoryMax: 4096, memoryMin: 1024, javaPath: '', jvmArgs: '', keepOpen: true, showSnapshots: false, bedrockDataPath: '' },
    accounts: [{ id: 'acc', name: 'ProspectorDev', uuid: '069a79f444e94726a5befca90e38aaf5' }], activeAccount: 'acc', selected: { java: 'a1', bedrock: 'b1' },
    history: [{ instanceId: 'a1', at: now - 2*d, world: 'Vanilla Survival' }, { instanceId: 'a2', at: now - 5*d, world: 'Creative Build' }, { instanceId: 'a3', at: now - 7*d, world: 'Nether Hub' }, { instanceId: 'b1', at: now - 14*d }],
    version: '1.0.0', platform: 'win32', dataDir: 'C:\\Users\\you\\AppData\\Roaming\\plunder', running: [], portable: true, totalMemMB: 32603 }
  const worlds = [
    { edition: 'java', instanceId: 'a1', instanceName: 'Vanilla Survival', mc: '1.21.10', loader: 'vanilla', folder: 'Survival World', name: 'Survival World', lastPlayed: now - 2*d, backups: 2 },
    { edition: 'java', instanceId: 'a2', instanceName: 'Fabric Optimized', mc: '1.21.1', loader: 'fabric', folder: 'Creative Build', name: 'Creative Build', lastPlayed: now - 5*d, backups: 0 },
    { edition: 'java', instanceId: 'a3', instanceName: 'Create Adventures', mc: '1.20.1', loader: 'quilt', folder: 'Nether Hub', name: 'Nether Hub', lastPlayed: now - 7*d, backups: 1 }
  ]
  const hits = n => Array.from({ length: n }, (_, i) => ({ source: 'modrinth', id: 'p' + i, title: ['Sodium', 'Fabric API', 'Iris Shaders', 'Lithium', 'Mod Menu', 'Xaero\'s Minimap'][i % 6], author: ['jellysquid3', 'modmuss50', 'coderbot', 'jellysquid3', 'Prospector', 'xaero96'][i % 6], description: 'A modern rendering engine and client-side optimization mod for Minecraft that greatly improves frame rates.', icon: null, downloads: [52e6, 98e6, 41e6, 30e6, 70e6, 22e6][i % 6], follows: 21000 - i * 900, categories: ['optimization', 'fabric', 'quilt'], updated: new Date(now - (i + 1) * 3 * d).toISOString(), url: 'https://modrinth.com', versions: ['1.21.1'] }))
  const packs = [{ ...hits(1)[0], id: 'atm', title: 'Fabulously Optimized', categories: ['fabric'], downloads: 2.6e6, versions: ['1.21.1'] }, { ...hits(1)[0], id: 'bm', title: 'Better Minecraft', categories: ['fabric'], downloads: 1.8e6, versions: ['1.21.1'] }]
  const servers = [{ id: 's1', edition: 'java', name: 'OurTech Survival', host: 'play.ourtech.us', port: 25565 }, { id: 's2', edition: 'java', name: 'Hypixel', host: 'mc.hypixel.net', port: 25565 }, { id: 's3', edition: 'bedrock', name: 'OurTech Bedrock', host: 'play.ourtech.us', port: 19132 }, { id: 's4', edition: 'java', name: 'Old Test Server', host: 'test.example.com', port: 25570 }]
  const status = { s1: { online: true, ping: 38, version: 'Paper 1.21.1', players: { online: 3, max: 20, sample: ['ProspectorDev', 'Kiwi_Builds', 'RedstoneRay'] }, motd: 'Welcome aboard, matey! Survival · Land claims · Weekly events' }, s2: { online: true, ping: 64, version: 'Requires MC 1.8 / 1.21', players: { online: 31244, max: 200000, sample: [] }, motd: 'Hypixel Network [1.8-1.21] — SKYBLOCK UPDATE' }, s3: { online: true, ping: 41, version: '1.21.101', players: { online: 2, max: 10, sample: [] }, motd: 'OurTech Bedrock — Survival' }, s4: { online: false, error: 'No response' } }
  const pmcHits = ['Villager Variety Addon', 'Structures from the Past', 'Fabulous Furnished', 'Unshrinkable', 'Police Extreme', 'Better Weapons'].map((t, i) => ({ source: 'planetminecraft', id: 'u' + i, url: 'https://www.planetminecraft.com/mod/x' + i + '/', title: t, author: ['redstonegamesb', 'TryzzMC', 'Furnisher', 'Arturxxsh', 'Mystery_Montero', 'Smith'][i], description: 'A Bedrock add-on that adds new content and features to your world, fully compatible with the latest version.', icon: null, downloads: null, categories: ['mod'] }))
  const R = {
    'stats:get': () => ({ sessions: Array.from({ length: 14 }, (_, i) => ({ instanceId: ['a1','a2','a3'][i % 3], start: now - (i % 7) * d - 3600e3, ms: (40 + i * 13) * 60e3 })) }),
    'deps:check': () => ({ mods: 12, missing: [{ id: 'cloth-config', neededBy: ["Reese's Sodium Options"] }], conflicts: [] }),
    'skins:list': () => [], 'skins:profile': () => ({ name: 'ProspectorDev', skin: null, capes: [{ id: 'c1', alias: 'Migrator', active: true, url: '' }] }),
    'update:check': () => ({ configured: true, current: '1.7.0', latest: '1.7.1', newer: true, hasFile: true }),
    'updates:check': () => ({ updates: { 'mods/sodium-fabric-0.6.jar': { versionName: '0.6.5' }, 'mods/lithium.jar': { versionName: '0.14.2' } }, errors: [] }),
    'bv:installing': () => false,
    'bdata:status': () => ({ kind: 'release', isolated: true, dir: 'x', size: 3.2e8, active: true }),
    'bv:check': () => ({ supported: true, devMode: false, gamingServices: true, active: { release: { version: '1.21.12004.0', dev: false, plunder: null } } }),
    'bv:installed': () => [{ id: '1.21.50.7', version: '1.21.50.7', kind: 'release', size: 1.4e9 }, { id: '1.20.81.1', version: '1.20.81.1', kind: 'release', size: 1.3e9 }],
    'bv:available': () => ['1.21.121.1','1.21.120.4','1.21.114.1','1.21.113.1','1.21.111.1','1.21.101.1','1.21.94.2','1.21.50.7','1.20.81.1'].map(v => ({ version: v, kind: 'release', urls: ['x'] })).concat([{ version: '1.21.130.20', kind: 'preview', urls: ['x'] }]),
    'assoc:status': () => ({ supported: true, registered: false, defaults: { '.mcaddon': false, '.mcpack': false, '.mcworld': false, '.mctemplate': false }, allDefault: false }),
    'servers:list': () => servers, 'servers:status': l => Object.fromEntries(l.map(x => [x.id, status[x.id] || { online: true, ping: 52, version: '1.21.1', players: { online: 0, max: 8, sample: [] }, motd: 'A Minecraft Server' }])),
    'servers:game': () => ({ java: [{ edition: 'java', name: 'Friends Realm SMP', host: 'smp.friends.gg', port: 25565, instanceId: 'a1', instanceName: 'Vanilla Survival' }], bedrock: [] }),
    'web:search': q => ({ hits: q.site === 'modbay' ? pmcHits.map(h => ({ ...h, source: 'modbay', url: h.url.replace('www.planetminecraft.com/mod', 'modbay.org/mods') })) : pmcHits, hasMore: true }),
    'import:detect': () => [
      { launcher: 'Modrinth App', name: 'Fabric Fun', dir: 'C:\\Users\\you\\AppData\\Roaming\\ModrinthApp\\profiles\\Fabric Fun', mc: '1.21.1', loader: 'fabric', loaderVersion: '0.16.9', counts: { worlds: 3, mods: 48, resourcepacks: 2, shaderpacks: 1 }, worlds: ['Survival', 'Creative Test', 'Hardcore'], hasOptions: true, hasServers: true, hasScreenshots: true },
      { launcher: 'AstralRinth', name: 'Skyblock', dir: 'C:\\Users\\you\\AppData\\Roaming\\AstralRinthApp\\profiles\\Skyblock', mc: '1.20.1', loader: 'fabric', guessed: true, counts: { worlds: 1, mods: 12, resourcepacks: 0, shaderpacks: 0 }, worlds: ['Sky'], hasOptions: true, hasServers: false, hasScreenshots: false },
      { launcher: 'CurseForge', name: 'All the Mods 9', dir: 'C:\\Users\\you\\curseforge\\minecraft\\Instances\\ATM9', mc: '1.20.1', loader: 'forge', counts: { worlds: 2, mods: 410, resourcepacks: 1, shaderpacks: 0 }, worlds: ['ATM World', 'Test'], hasOptions: true, hasServers: true, hasScreenshots: false }],
    'state:get': () => state, 'instances:list': () => inst, 'worlds:java': id => id ? worlds.filter(w => w.instanceId === id) : worlds,
    'worlds:bedrock': () => [{ edition: 'bedrock', folder: 'xyz=', root: 'C:\\x', name: 'Bedrock Realm', lastPlayed: now - 14*d, backups: 1 }],
    'content:search': q => q.type === 'modpack' ? { total: 2, hits: packs } : q.edition === 'bedrock' || q.source === 'curseforge' ? Promise.reject(Object.assign(new Error('CurseForge needs a key'), { code: 'NO_CF_KEY' })) : { total: 40, hits: hits(6) },
    'bedrock:info': () => ({ version: '1.21.10101.0', roots: ['C:\\Users\\you\\AppData\\Roaming\\Minecraft Bedrock\\Users\\Shared\\games\\com.mojang'] }),
    'content:list': () => [{ type: 'mod', file: 'sodium-fabric-0.6.jar', key: 'mods/sodium-fabric-0.6.jar', enabled: true, size: 1200000, title: 'Sodium', source: 'modrinth', version: '0.6.0', url: 'https://modrinth.com/project/AANobbMI' }, { type: 'mod', file: 'lithium.jar.disabled', key: 'mods/lithium.jar', enabled: false, size: 700000, title: 'Lithium', source: 'curseforge', url: 'https://www.curseforge.com/projects/1' }, { type: 'resourcepack', file: 'FreshAnimations.zip', key: 'resourcepacks/FreshAnimations.zip', enabled: true, size: 3000000, title: 'Fresh Animations', source: 'file' }],
    'worlds:backups': () => [{ edition: 'java', owner: 'a1', world: 'Survival World', file: 'x.zip', size: 52e6, created: now - d }],
    'bedrock:gameServers': () => [], 'bedrock:packs': () => [], 'versions:minecraft': () => ({ latest: { release: '1.21.10' }, versions: [{ id: '1.21.10', type: 'release' }, { id: '1.21.1', type: 'release' }] }), 'versions:loader': () => [{ version: '0.16.9', stable: true }]
  }
  window.api = { call: async (n, ...a) => { const f = R[n]; return f ? f(...a) : null }, on: () => () => {}, filePath: () => '' }
})()
