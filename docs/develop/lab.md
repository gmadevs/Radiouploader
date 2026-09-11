# Trying an installer on a desktop

```bash
npm run lab -- setup
npm run lab -- up windows-2025
npm run lab -- connect i-0123456789abcdef0
npm run lab -- down i-0123456789abcdef0
```

The [install job](/develop/packaging#installing-what-was-built) proves on every build that
each package installs and the app boots. What it cannot see is what a person sees:
SmartScreen on an installer Edge downloaded, the installer's own window, the Start menu,
removing the app from Settings, an AppImage opened with a double-click, a sign-in to
Radiopaedia with a keyring behind it. `scripts/lab.mjs` rents a desktop on EC2 for that, for
as long as the trying takes, and makes sure it does not outlive it.

What has been tried, on which system and with which installer, is kept in
[live tests](/develop/live-tests), along with the machines still to try.

::: danger Sample data only
An instance is a computer in somebody else's building. Nothing from a real patient goes on
one — the study `npm run sample` writes is what to upload from it.
:::

## The systems

| `up` takes | What starts | Instance | ~$/hour in London |
|---|---|---|---|
| `windows-2025` | Windows Server 2025 | `t3.large`, 8 GB | 0.12 |
| `windows-2022` | Windows Server 2022 | `t3.large`, 8 GB | 0.12 |
| `ubuntu-2404` | Ubuntu 24.04 with XFCE | `t3.medium`, 4 GB | 0.05 |
| `ubuntu-2204` | Ubuntu 22.04 with XFCE | `t3.medium`, 4 GB | 0.05 |

Two of those are near misses, and knowingly. **EC2 has no Windows 10 or 11**, only Windows
Server: 2022 is built on the same base as Windows 10 and 2025 on the same as Windows 11
24H2, which is close enough for an installer and not the same thing. **The Ubuntu desktops
are XFCE over xrdp, not GNOME**: the kernel, AppArmor, the libraries and apt are Ubuntu's
own, and the shell around them is not.

A windows instance is ready about five minutes after `up`; an Ubuntu one takes about ten,
because the desktop is installed on its first boot rather than baked into an image that
would cost money to keep.

## Once

1. An AWS account, with a **budget alert** set in Billing before anything is launched.
2. An IAM user with console access, `AdministratorAccess` and MFA — not the root user — and
   on the Mac:
   ```bash
   brew install awscli
   brew install --cask session-manager-plugin
   aws login --profile lab
   ```
   The script uses that `lab` profile by itself whenever `AWS_PROFILE` is not set, so a new
   terminal window needs no export.
   `aws login`, in AWS CLI 2.32 and later, signs in through the browser as that user and
   hands the CLI credentials that last minutes and renew themselves for twelve hours — never
   an access key, least of all anywhere near this repository, which is public. IAM Identity
   Center would do the same, but on a single account it offers no permission sets until an
   AWS Organization has been created around it.
3. **Windows App** from the Mac App Store, which is the remote-desktop client for both.
4. `npm run lab -- setup`, which creates, if they are not there already:
   - a role for the instances that lets their agent reach Session Manager and nothing more;
   - a role for EventBridge Scheduler that may terminate an instance only if it carries this
     lab's `project` tag;
   - a security group in the default VPC with **no inbound rule at all**.

The region is `eu-west-2`, London, unless `AWS_REGION` says otherwise. A new account came
with 1280 on-demand vCPUs there and five in Frankfurt — two lab machines at once, and no
third — and a remote desktop does not notice the difference in distance. Milan is closer
still, but has to be enabled on an account by hand.

## A session

`up` prints the instance and when it expires. `connect` waits for the instance to reach
Session Manager and for its desktop to finish installing, then opens a tunnel and prints
where to point Windows App and which user to sign in as. The password goes on the clipboard,
not on the screen, where a terminal's scrollback would keep it. Download the installer inside the
instance, from the releases page, with its browser: a file that arrived that way is the one
SmartScreen reacts to.

## How it ends

Three ways to end it yourself, and two ways it ends on its own:

- **`npm run lab -- down <instance>`**, or `--all`;
- **closing the tunnel**: Ctrl+C in `connect`, which then asks whether to terminate;
- **shutting it down from inside** — every instance is launched to terminate, not stop, when
  its own system powers off;
- **its own clock**: a scheduled task on Windows, which a reboot does not forget, and
  `shutdown -h` on Linux;
- **a clock outside it**: a one-time EventBridge Scheduler schedule that terminates the
  instance five minutes after it expires, and then deletes itself. That one works when the
  system inside has hung, and a launch whose schedule cannot be created is terminated on the
  spot rather than left with one clock.

Nothing is ever stopped rather than terminated. A stopped instance still pays for its disk,
and the disk here is deleted with the instance.

## Why no port is open

The desktop is never on the internet. The instance's own agent connects **out** to Session
Manager, and `connect` asks Session Manager for a tunnel to port 3389 through that
connection; the security group has nothing in it for a scanner to find.

The password is made at random for each launch and passed in the instance's user data. That
is readable by anyone with access to the account and by any process on the machine, which is
acceptable for a machine with no open port that lives for hours — and `connect` reads it back
from there rather than leaving a copy on this disk.

## What it costs

An afternoon of two hours on Windows and two on Ubuntu comes to about forty cents. What keeps
it there:

- **CPU credits on standard.** A `t3` launches as *unlimited* and bills for a CPU kept busy,
  which a desktop installing itself does; on standard it slows down instead.
- **The disk goes with the instance.**
- **`--spot`**, for Linux, takes 60–70% off in exchange for AWS being allowed to take the
  machine back. Not the default: losing a desktop halfway through a test costs more than it
  saves.

A public IPv4 address adds half a cent an hour. The agent needs it to reach Session Manager;
nothing comes in through it.

## Why it does not run the install test

It could: Session Manager runs commands on the instance. But it runs them as SYSTEM or root,
in a session with no desktop, which is what the containers in the install job already do on
every build for nothing. What a rented machine adds is somebody sitting in front of it.
