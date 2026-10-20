GDKLaunchShim.exe and GDKDecryptHelper.exe are compiled from the open-source
MCLauncher project (https://github.com/MCMrARM/mc-w10-version-launcher, commit 4a4e213),
licensed under the GNU GPL v3 (see LICENSE-GPL-3.0.txt).

Changes: GDKLaunchShim.cpp gained two __CRT_UUID_DECL lines so it builds with MinGW.
The exact sources used are in the "source" folder; tinyxml2 is unchanged from that commit.
Built with: x86_64-w64-mingw32-g++ -O2 -s -municode -mwindows -static -std=c++17
