// Puts the Plunder icon and name into the Windows exe (works without Windows tools).
import fs from 'fs'
import * as ResEdit from 'resedit'
export function setIcon (exePath, icoPath) {
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true })
  const res = ResEdit.NtExecutableResource.from(exe)
  const ico = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath))
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries)
  const id = groups.length ? groups[0].id : 1, lang = groups.length ? groups[0].lang : 1033
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, id, lang, ico.icons.map(i => i.data))
  const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0]
  if (vi) {
    vi.setStringValues({ lang: 1033, codepage: 1200 }, { FileDescription: 'Plunder', ProductName: 'Plunder', CompanyName: 'Plunder', OriginalFilename: 'Plunder.exe', LegalCopyright: '' })
    vi.outputToResourceEntries(res.entries)
  }
  res.outputResource(exe)
  fs.writeFileSync(exePath, Buffer.from(exe.generate()))
}
import { fileURLToPath } from 'url'
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) { setIcon(process.argv[2], process.argv[3]); console.log('icon set') }
