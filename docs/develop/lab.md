# Trying an installer on a desktop

```bash
npm run lab -- setup
npm run lab -- up windows-2025
npm run lab -- connect i-0123456789abcdef0
npm run lab -- down i-0123456789abcdef0
```

The [install job](/develop/packaging#installing-what-was-built) checks on every build that
each package installs and the app starts. It cannot check what a person sees: SmartScreen on
an installer downloaded with Edge, the installer window, the Start menu, uninstalling from
Settings, opening an AppImage with a double-click, or signing in to Radiopaedia with a
keyring. `scripts/lab.mjs` rents a desktop on EC2 for this, for as long as the test takes,
and makes sure it is deleted afterwards.

The results of these tests, and the systems still to test, are in
[live tests](/develop/live-tests).

::: danger Sample data only
An instance is a computer run by someone else. Never put real patient data on it; upload the
study that `npm run sample` generates.
:::

## Systems

| `up` argument | System | Instance | Approx. $/hour in London |
|---|---|---|---|
| `windows-2025` | Windows Server 2025 | `t3.large`, 8 GB | 0.12 |
| `windows-2022` | Windows Server 2022 | `t3.large`, 8 GB | 0.12 |
| `ubuntu-2404` | Ubuntu 24.04 with XFCE | `t3.medium`, 4 GB | 0.05 |
| `ubuntu-2204` | Ubuntu 22.04 with XFCE | `t3.medium`, 4 GB | 0.05 |

EC2 has no Windows 10 or 11, only Windows Server. Windows Server 2022 is based on the same
code as Windows 10, and 2025 on the same as Windows 11 24H2: close enough to test an
installer, but not identical. The Ubuntu desktops are XFCE over xrdp, not GNOME; the kernel,
AppArmor, libraries and apt are Ubuntu's.

A Windows instance is ready about five minutes after `up`, an Ubuntu instance after about
ten, because its desktop is installed at first boot instead of from a stored image, which
would cost money to keep.

## One-time setup

1. An AWS account, with a budget alert set in Billing before you launch anything.
2. An IAM user with console access, `AdministratorAccess` and MFA (not the root user), and on
   the Mac:
   ```bash
   brew install awscli
   brew install --cask session-manager-plugin
   aws login --profile lab
   ```
   The script uses the `lab` profile when `AWS_PROFILE` is not set. `aws login` (AWS CLI 2.32
   and later) signs in through the browser and gives the CLI short-lived credentials that
   renew for twelve hours, so no access key is needed. Never put an access key in this
   repository, which is public. IAM Identity Center would also work, but on a single account
   it needs an AWS Organization first.
3. **Windows App** from the Mac App Store, the remote-desktop client for both systems.
4. `npm run lab -- setup`, which creates, if they do not exist yet:
   - a role for the instances that allows their agent to reach Session Manager and nothing
     else;
   - a role for EventBridge Scheduler that can terminate only instances with this lab's
     `project` tag;
   - a security group in the default VPC with no inbound rules.

The region is `eu-west-2` (London) unless `AWS_REGION` is set. A new account had 1280
on-demand vCPUs there and only five in Frankfurt, enough for two lab machines. The distance
makes no noticeable difference to a remote desktop. Milan is closer, but has to be enabled
on the account by hand.

## A session

`up` prints the instance ID and when it expires. `connect` waits until the instance is
reachable through Session Manager and its desktop is installed, then opens a tunnel and
prints the address and user name for Windows App. The password is copied to the clipboard,
not printed, so it does not stay in the terminal's scrollback.

Download the installer inside the instance, from the releases page, with its browser:
SmartScreen reacts only to files downloaded that way.

## How a session ends

You can end it in three ways:

- `npm run lab -- down <instance>`, or `--all`;
- closing the tunnel with Ctrl+C in `connect`, which then asks whether to terminate the
  instance;
- shutting down the system inside the instance, which terminates it, because every instance
  is launched to terminate, not stop, when it powers off.

It also ends on its own in two ways:

- a timer inside the instance: a scheduled task on Windows, which survives a reboot, and
  `shutdown -h` on Linux;
- a timer outside it: a one-time EventBridge Scheduler schedule that terminates the instance
  five minutes after it expires, and then deletes itself. This works even if the system
  inside has stopped responding. If the schedule cannot be created, the instance is
  terminated immediately.

Instances are always terminated, never stopped, because a stopped instance still costs money
for its disk. The disk is deleted with the instance.

## No open ports

The desktop is not reachable from the internet. The instance's agent connects out to Session
Manager, and `connect` asks Session Manager for a tunnel to port 3389 through that
connection. The security group has no inbound rules.

The password is generated at random for each launch and passed in the instance's user data,
where anyone with access to the account and any process on the instance can read it. That is
acceptable for a machine with no open ports that exists for a few hours. `connect` reads the
password from the user data instead of storing a copy on the Mac.

## Cost

Two hours on Windows and two on Ubuntu cost about 40 cents. The costs stay low because:

- the CPU credits are set to *standard*. A `t3` instance launches as *unlimited* by default,
  which charges extra for a busy CPU, as during the desktop installation; on *standard* it
  slows down instead;
- the disk is deleted with the instance;
- `--spot`, for Linux, reduces the price by 60–70%, but AWS can take the machine back at any
  time. It is not the default, because losing a desktop during a test costs more time than
  it saves.

The public IPv4 address costs about half a cent an hour. The agent needs it to reach Session
Manager; nothing connects in through it.

## Why the lab does not run the install test

Session Manager could run commands on the instance, but it runs them as SYSTEM or root,
without a desktop. The containers in the install job already do that on every build, at no
cost. A rented machine is useful only for a person to test on.
