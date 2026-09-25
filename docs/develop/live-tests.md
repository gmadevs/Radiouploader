# Live tests

The [install job](/develop/packaging#installing-what-was-built) installs every installer on
nine systems before a release is drafted, and opens the installed app. It cannot test what a
person sees and does. This page records the tests done by hand: the version, the system, the
installer, and the result.

A tick means that the steps below were done by hand on that system with that installer, and
nothing more. A system without a row has not been tested by hand, whatever the install job
reports for it.

## What a live test is

1. **Download the installer as a user would**: from the
   [releases page](https://github.com/gmadevs/Radiouploader/releases) with the system's own
   browser, or with Homebrew on macOS.
2. **Install and open it**, including the step the system requires for an unsigned app:
   Gatekeeper, SmartScreen or `chmod +x`.
3. **Sign in to Radiopaedia.**
4. **Import the sample study** (`npm run sample`), anonymise it and **upload a draft case**.
5. **Uninstall it**, where the installer has an uninstaller: Settings → Apps on Windows,
   `apt remove` for the deb.

Never put real patient data on a rented machine; use the sample study.

## Done

| Date | Version | System | Installer | Where | Result |
|---|---|---|---|---|---|
| 2026-09-09 | 1.3.1 | macOS 15.7.9, Intel | Homebrew cask (Intel dmg) | the maintainer's Mac | ✅ Installed, signed in, uploaded; in daily use. Not uninstalled |
| 2026-09-11 | 1.3.2 | Ubuntu 22.04, XFCE | AppImage x64 | `npm run lab -- up ubuntu-2204` | ❌ Sign-in could not open a browser on a system without `xdg-open` ([#7](https://github.com/gmadevs/Radiouploader/issues/7)), fixed in 1.3.3 |
| 2026-09-11 | 1.3.3 | macOS 15.7.9, Intel | Homebrew cask, upgraded from 1.3.1 | the maintainer's Mac | ✅ Upgraded with `brew upgrade` and the quarantine step, signed in, uploaded. Not uninstalled |
| 2026-09-11 | 1.3.3 | Windows Server 2025, build 26100 | Setup `.exe` x64 | `npm run lab -- up windows-2025` | ✅ Downloaded with Edge, installed, signed in, uploaded (the draft checked on Radiopaedia), and uninstalled from Settings. No SmartScreen warning appeared. Start menu not checked |
| 2026-09-11 | 1.3.3 | Ubuntu 24.04, XFCE | AppImage x64 | `npm run lab -- up ubuntu-2404` | ✅ Downloaded with Firefox, started after `chmod +x` with AppArmor's user-namespace restriction, signed in, uploaded. `libfuse2t64` was already installed (the lab's xrdp depends on it), so FUSE was not tested |
| 2026-09-11 | 1.3.3 | Ubuntu 24.04, XFCE | deb amd64 | the same machine | ⚠️ Installed with apt and started, but shown in the Science menu without an icon ([#8](https://github.com/gmadevs/Radiouploader/issues/8)), fixed after 1.3.3. Removed completely with `apt remove` |

The absence of a SmartScreen warning on Windows Server does not show what happens on Windows
10 or 11: a server edition may not check downloaded apps as a client edition does. The install
guide therefore keeps the *More info → Run anyway* step until a client edition has been
tested.

## To do

Test these with the current release. Each row is one [lab](/develop/lab) machine and one
installer. When a test is done, move it to the table above with its result, including a
failure.

| | Command | System | Installer | What it tests |
|---|---|---|---|---|
| ☐ | `npm run lab -- up windows-2022` | Windows Server 2022 | Setup `.exe` x64 | the installer on the base shared with Windows 10, and the Start menu entry, which the 2025 test did not check |
| ☐ | `npm run lab -- up ubuntu-2204` | Ubuntu 22.04, XFCE | AppImage x64 | the fix for #7 on the system where it was found: run `sudo apt remove xdg-utils` first, because the lab now installs it |
| ☐ | `npm run lab -- up ubuntu-2204` | Ubuntu 22.04, XFCE | deb amd64 | installing from a browser download, the menu entry, and `apt remove` |

The two Ubuntu 22.04 rows can be done on one machine: install the AppImage, then the deb, in
the same session. Windows costs about 12 cents an hour and Ubuntu about 5.

## Not possible with the lab yet

| System | Installer | Reason |
|---|---|---|
| macOS on Apple silicon | dmg arm64 | no Apple silicon Mac available, and a Mac on EC2 is a dedicated host billed by the day |
| Linux on arm64 | AppImage and deb arm64 | the lab has no arm64 systems yet; a Graviton instance would work |
| Windows 10 and 11 | Setup `.exe` x64 | EC2 offers only Windows Server; a local virtual machine would work |
| Ubuntu desktop without FUSE 2 | AppImage | every lab machine has FUSE 2, because xrdp depends on it, so the step a new Ubuntu desktop needs before an AppImage starts cannot be tested there |
