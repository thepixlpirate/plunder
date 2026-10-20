# Plunder

An all-in-one Minecraft launcher for **Java and Bedrock**, with a pirate theme.

## Features
- **Java**: Vanilla, Fabric, Quilt, Forge and NeoForge instances. Java itself downloads automatically.
- **Mods & modpacks** from Modrinth and CurseForge, with dependency warnings, update checks and "Update all".
- **Bedrock**: run several versions side by side, give each installation its own worlds and add-ons, and get add-ons from Planet Minecraft, ModBay and CurseForge.
- **Import** worlds, mods and settings from other launchers (Modrinth App, AstralRinth, Prism, CurseForge, GDLauncher, the official launcher).
- **Share modpacks** as `.mrpack` files.
- **Crash helper** that explains crashes in plain words.
- **Automatic world backups**, a servers page with live status, a skins & capes manager, play-time stats.
- **Portable**: one `Plunder.exe`. Everything it saves stays in a `Plunder Data` folder next to it.

## Download
Grab `Plunder.exe` from the [latest release](https://github.com/thepixlpirate/plunder/releases/latest). Put it in its own folder and run it. Plunder updates itself from this page's releases.

## Building from source
```
npm install
npm run dist      # creates dist/Plunder.exe
```

## Credits
Bedrock multi-version support uses helper tools built from [MCLauncher](https://github.com/MCMrARM/mc-w10-version-launcher) (GPL-3.0). See `build/bedrock-tools/`.
Not affiliated with Mojang or Microsoft.
