# Live tests

The [install job](/develop/packaging#installing-what-was-built) installs every installer on
nine systems before a release is drafted, and opens the app from where the install left it.
What it cannot do is sit in front of it. This page is the record of the tests a person did:
which version, on which system, from which installer, and what happened.

A tick here means the steps below were done by hand on that system, with that installer —
nothing wider. A system with no row has not been tried by anyone, whatever the install job
says about it.

## What a live test is

1. **Get the installer the way a user would**: from the
   [releases page](https://github.com/gmadevs/Radiouploader/releases) in the system's own
   browser, or with Homebrew on macOS.
2. **Install it and open it**, through whatever the system puts in the way of an unsigned
   app — Gatekeeper, SmartScreen, `chmod +x`.
3. **Sign in to Radiopaedia.**
4. **Import the sample study** (`npm run sample`), anonymise it, and **upload a draft**.
5. **Uninstall it**, where the installer has an uninstall: Settings → Apps on Windows,
   `apt remove` for the deb.

Nothing from a real patient goes on a rented machine — the sample study is what to upload
from one.

## Done

| Date | Version | System | Installer | Where | Result |
|---|---|---|---|---|---|
| 2026-09-09 | 1.3.1 | macOS 15.7.9, Intel | Homebrew cask (Intel dmg) | the maintainer's Mac | ✅ Works, in daily use |
| 2026-09-11 | 1.3.2 | Ubuntu 22.04, XFCE | AppImage x64 | `npm run lab -- up ubuntu-2204` | ❌ Sign-in could not reach a browser on a system without `xdg-open` — [#7](https://github.com/gmadevs/Radiouploader/issues/7), fixed in 1.3.3 |

## To do for 1.3.3

Each row is one machine from [the lab](/develop/lab) and one installer. When it is done it
moves to the table above, with its result — a failure included, which is the point of
having tried.

| | Command | System | Installer | What it is there to show |
|---|---|---|---|---|
| ☐ | `brew upgrade --cask radiouploader` | macOS 15.7.9, Intel | Homebrew cask | 1.3.3 on the Mac already in use, through the upgrade the app itself offers |
| ☐ | `npm run lab -- up windows-2025` | Windows Server 2025 | Setup `.exe` x64 | SmartScreen on a downloaded installer, the installer's own window, the Start menu, uninstalling from Settings |
| ☐ | `npm run lab -- up windows-2022` | Windows Server 2022 | Setup `.exe` x64 | The same on the base Windows 10 shares |
| ☐ | `npm run lab -- up ubuntu-2204` | Ubuntu 22.04, XFCE | AppImage x64 | The #7 fix where it was found: run `sudo apt remove xdg-utils` first, since the lab now installs it |
| ☐ | `npm run lab -- up ubuntu-2204` | Ubuntu 22.04, XFCE | deb amd64 | Installing from the browser download, the menu entry, `apt remove` |
| ☐ | `npm run lab -- up ubuntu-2404` | Ubuntu 24.04, XFCE | AppImage x64 | The sandbox under AppArmor's user-namespace restriction, from a real desktop session |
| ☐ | `npm run lab -- up ubuntu-2404` | Ubuntu 24.04, XFCE | deb amd64 | The AppArmor profile the deb installs, and `libasound2t64` pulled in by apt |

One machine can take both of its rows: install the AppImage, then the deb, in the same
session. Windows costs about twelve cents an hour and Ubuntu about five.

## Not reachable from here yet

| System | Installer | Why not |
|---|---|---|
| macOS on Apple silicon | dmg arm64 | No Apple silicon Mac to hand, and a Mac on EC2 is a dedicated host billed by the day |
| Linux on arm64 | AppImage and deb arm64 | The lab has no arm64 systems yet; a Graviton instance would do it |
| Windows 10 and 11 themselves | Setup `.exe` x64 | EC2 has only Windows Server; a local virtual machine would |
