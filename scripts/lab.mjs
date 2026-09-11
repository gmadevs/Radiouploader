/**
 * Throwaway Windows and Linux desktops on EC2, for trying an installer the way a
 * person would: downloaded with a browser, opened with a double-click, removed
 * from Settings. The install job in build.yml already proves every package
 * installs and boots; what it cannot see is SmartScreen, a desktop session and a
 * sign-in with a keyring behind it, and that is all this is for.
 *
 *   npm run lab -- setup
 *   npm run lab -- up <system> [--hours 3] [--spot]
 *   npm run lab -- connect <instance>
 *   npm run lab -- list
 *   npm run lab -- down <instance…> | --all
 *
 * Nothing here listens on the internet. The instances have no inbound rule, and
 * the desktop is reached through a Session Manager tunnel that the instance's
 * own agent opened outwards. Every instance also ends on its own, twice over —
 * see `up`. Sample data only: never a real study.
 */
import crypto from 'node:crypto'
import net from 'node:net'
import readline from 'node:readline/promises'
import { spawn, spawnSync } from 'node:child_process'

// London rather than Frankfurt: a new account came with 1280 on-demand vCPUs
// there and 5 in Frankfurt, which is two lab machines at once and no third.
const REGION = process.env.AWS_REGION ?? 'eu-west-2'
const PROJECT = 'radiouploader-lab'
const INSTANCE_ROLE = `${PROJECT}-instance`
const SCHEDULER_ROLE = `${PROJECT}-scheduler`
const MAX_HOURS = 12
const WINDOWS_READY = 'C:\\ProgramData\\radiouploader-lab-ready'
const LINUX_READY = '/var/lib/radiouploader-lab-ready'

/**
 * The image is named through AWS's and Canonical's public parameters, which
 * always point at the newest build, so there is no AMI id here to go stale.
 */
const SYSTEMS = {
  'windows-2025': {
    name: 'Windows Server 2025',
    windows: true,
    image: '/aws/service/ami-windows-latest/Windows_Server-2025-English-Full-Base',
    type: 't3.large',
    disk: 30,
    user: 'Administrator',
    minutes: 5
  },
  'windows-2022': {
    name: 'Windows Server 2022',
    windows: true,
    image: '/aws/service/ami-windows-latest/Windows_Server-2022-English-Full-Base',
    type: 't3.large',
    disk: 30,
    user: 'Administrator',
    minutes: 5
  },
  'ubuntu-2404': {
    name: 'Ubuntu 24.04, XFCE',
    windows: false,
    image: '/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id',
    type: 't3.medium',
    disk: 20,
    user: 'tester',
    minutes: 10
  },
  'ubuntu-2204': {
    name: 'Ubuntu 22.04, XFCE',
    windows: false,
    image: '/aws/service/canonical/ubuntu/server/22.04/stable/current/amd64/hvm/ebs-gp2/ami-id',
    type: 't3.medium',
    disk: 20,
    user: 'tester',
    minutes: 10
  }
}

class Problem extends Error {}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * One AWS CLI call. `quiet` lists error codes that mean "not there" rather than
 * "went wrong", for which the answer is null.
 */
function aws(args, { quiet = [] } = {}) {
  const result = spawnSync('aws', [...args, '--region', REGION, '--output', 'json'], { encoding: 'utf8' })
  if (result.error?.code === 'ENOENT') throw new Problem('the AWS CLI is not installed: brew install awscli')
  if (result.error) throw new Problem(`aws: ${result.error.message}`)
  if (result.status !== 0) {
    const message = result.stderr.trim()
    if (quiet.some((code) => message.includes(code))) return null
    const hint = /login|sso|expired|credentials/i.test(message) ? '\nsign in first: aws login --profile lab' : ''
    throw new Problem(`aws ${args[0]} ${args[1]}: ${message}${hint}`)
  }
  return result.stdout.trim() ? JSON.parse(result.stdout) : {}
}

/**
 * A role or instance profile made a moment ago is not yet usable everywhere,
 * and the first launch after `setup` is refused for it. Ask again for a minute.
 */
async function awsPatiently(args, notYet) {
  for (let attempt = 1; ; attempt++) {
    const answer = aws(args, { quiet: attempt < 12 ? [notYet] : [] })
    if (answer) return answer
    await sleep(5000)
  }
}

const tag = (instance, key) => instance.Tags?.find((t) => t.Key === key)?.Value
const scheduleName = (id) => `${PROJECT}-${id}`
const local = (date) => date.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })

function ensureRole(name, principal, condition) {
  if (aws(['iam', 'get-role', '--role-name', name], { quiet: ['NoSuchEntity'] })) return
  const trust = {
    Version: '2012-10-17',
    Statement: [{ Effect: 'Allow', Principal: principal, Action: 'sts:AssumeRole', ...(condition && { Condition: condition }) }]
  }
  aws(['iam', 'create-role', '--role-name', name, '--assume-role-policy-document', JSON.stringify(trust), '--tags', `Key=project,Value=${PROJECT}`])
  console.log(`created role     : ${name}`)
}

function defaultVpc() {
  const [vpc] = aws(['ec2', 'describe-vpcs', '--filters', 'Name=is-default,Values=true']).Vpcs
  if (!vpc) throw new Problem(`${REGION} has no default VPC; create one in the VPC console (Actions → Create default VPC)`)
  return vpc.VpcId
}

function securityGroup(vpc) {
  return aws(['ec2', 'describe-security-groups', '--filters', `Name=group-name,Values=${PROJECT}`, `Name=vpc-id,Values=${vpc}`])
    .SecurityGroups[0]
}

/** Everything `up` needs and nothing it does not. Safe to run again. */
function setup() {
  const { Account } = aws(['sts', 'get-caller-identity'])
  console.log(`account          : ${Account}, ${REGION}`)

  // What lets the instance's agent reach Session Manager, and no more.
  ensureRole(INSTANCE_ROLE, { Service: 'ec2.amazonaws.com' })
  aws(['iam', 'attach-role-policy', '--role-name', INSTANCE_ROLE, '--policy-arn', 'arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore'])
  if (!aws(['iam', 'get-instance-profile', '--instance-profile-name', INSTANCE_ROLE], { quiet: ['NoSuchEntity'] })) {
    aws(['iam', 'create-instance-profile', '--instance-profile-name', INSTANCE_ROLE])
    console.log(`created profile  : ${INSTANCE_ROLE}`)
  }
  const { InstanceProfile } = aws(['iam', 'get-instance-profile', '--instance-profile-name', INSTANCE_ROLE])
  if (!InstanceProfile.Roles.some((role) => role.RoleName === INSTANCE_ROLE)) {
    aws(['iam', 'add-role-to-instance-profile', '--instance-profile-name', INSTANCE_ROLE, '--role-name', INSTANCE_ROLE])
  }

  // The outside clock may terminate an instance, and only one this lab tagged.
  // The source-account condition keeps another account's schedule from borrowing it.
  ensureRole(SCHEDULER_ROLE, { Service: 'scheduler.amazonaws.com' }, { StringEquals: { 'aws:SourceAccount': Account } })
  const terminate = {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: 'ec2:TerminateInstances',
        Resource: '*',
        Condition: { StringEquals: { 'aws:ResourceTag/project': PROJECT } }
      }
    ]
  }
  aws(['iam', 'put-role-policy', '--role-name', SCHEDULER_ROLE, '--policy-name', 'terminate-lab-instances', '--policy-document', JSON.stringify(terminate)])

  const vpc = defaultVpc()
  if (!securityGroup(vpc)) {
    // Created with no inbound rule and given none: the tunnel is opened from
    // inside, so there is nothing on the internet to knock on.
    aws(['ec2', 'create-security-group', '--group-name', PROJECT, '--vpc-id', vpc,
      '--description', 'Radiouploader lab: no inbound rules, reached through Session Manager'])
    console.log(`created group    : ${PROJECT} in ${vpc}`)
  }
  console.log('SETUP OK')
}

/**
 * Made for one machine and dead with it. Upper case, lower case and a symbol,
 * which is what Windows asks of a password. Joined from parts rather than
 * written as one template string: GitGuardian read `Lab-${…}` assigned to a
 * variable called password as a password committed to a public repository.
 */
function throwawayPassword() {
  return ['Lab', crypto.randomBytes(15).toString('base64url')].join('-')
}

function windowsUserData(password, expires) {
  return `<powershell>
$password = '${password}'
net user Administrator $password

# The instance was launched to terminate when it shuts down, so this task is its
# own expiry. A task rather than shutdown /t, which a reboot would forget.
$action = New-ScheduledTaskAction -Execute 'shutdown.exe' -Argument '/s /t 60 /c "Radiouploader lab: this machine has expired"'
$trigger = New-ScheduledTaskTrigger -Once -At ([datetime]::Parse('${expires.toISOString()}'))
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable
Register-ScheduledTask -TaskName 'radiouploader-lab-expiry' -Action $action -Trigger $trigger -Settings $settings -User 'NT AUTHORITY\\SYSTEM' -RunLevel Highest -Force | Out-Null

Get-ScheduledTask -TaskName ServerManager -ErrorAction SilentlyContinue | Disable-ScheduledTask | Out-Null
New-Item -ItemType File -Force -Path '${WINDOWS_READY}' | Out-Null
</powershell>`
}

function linuxUserData(password, expires) {
  const minutes = Math.round((expires.getTime() - Date.now()) / 60_000)
  return `#!/bin/bash
set -euo pipefail
# The instance terminates when it powers off, so this is its own expiry.
shutdown -h +${minutes} 'Radiouploader lab: this machine has expired'

password='${password}'
useradd --create-home --shell /bin/bash --groups sudo tester
echo "tester:$password" | chpasswd

# The first boot runs its own apt in the background; wait for it rather than fail.
export DEBIAN_FRONTEND=noninteractive
apt="apt-get -y -q -o DPkg::Lock::Timeout=600"
$apt update
# xdg-utils because every real desktop has it, and nothing opens a link without
# it: the app's sign-in could not reach a browser on the first machine this made.
$apt install xfce4 xfce4-terminal dbus-x11 xrdp gnome-keyring xdg-utils
# Ubuntu's firefox package rather than snap install: it installs the same snap,
# and also the /usr/bin/firefox launcher and the x-www-browser alternative. A
# bare snap registers neither, and /snap/bin/firefox cannot stand in for them —
# it is a link to snap, which picks the app by the name it was called by. The
# desktop's Web Browser button and anything opening a link both failed with
# "Couldn't find a suitable web browser".
snap wait system seed.loaded
$apt install firefox

echo xfce4-session > /home/tester/.xsession
mkdir -p /home/tester/.config/xfce4
echo WebBrowser=firefox > /home/tester/.config/xfce4/helpers.rc
chown -R tester:tester /home/tester/.xsession /home/tester/.config
usermod -aG ssl-cert xrdp
systemctl enable xrdp
systemctl restart xrdp
touch ${LINUX_READY}
`
}

async function up(key, { hours, spot }) {
  const system = SYSTEMS[key]
  if (!system) throw new Problem(`no system called ${key ?? '(none)'}; there are ${Object.keys(SYSTEMS).join(', ')}`)
  if (!Number.isInteger(hours) || hours < 1 || hours > MAX_HOURS) {
    throw new Problem(`--hours takes a whole number from 1 to ${MAX_HOURS}`)
  }
  const { Account } = aws(['sts', 'get-caller-identity'])
  const group = securityGroup(defaultVpc())
  const scheduler = aws(['iam', 'get-role', '--role-name', SCHEDULER_ROLE], { quiet: ['NoSuchEntity'] })
  if (!group || !scheduler) throw new Problem('the lab is not set up in this account: npm run lab -- setup')
  if (group.IpPermissions.length > 0) {
    throw new Problem(`the ${PROJECT} security group has inbound rules, and this lab is built on it having none`)
  }

  const image = aws(['ssm', 'get-parameter', '--name', system.image]).Parameter.Value
  const [ami] = aws(['ec2', 'describe-images', '--image-ids', image]).Images
  const root = ami.BlockDeviceMappings.find((mapping) => mapping.DeviceName === ami.RootDeviceName)
  const disk = Math.max(system.disk, root?.Ebs?.VolumeSize ?? 0)

  const password = throwawayPassword()
  const expires = new Date(Date.now() + hours * 3_600_000)
  const tags = [
    { Key: 'Name', Value: `${PROJECT} ${key}` },
    { Key: 'project', Value: PROJECT },
    { Key: 'system', Value: key },
    { Key: 'expires', Value: expires.toISOString() }
  ]

  const args = [
    'ec2', 'run-instances',
    '--image-id', image,
    '--instance-type', system.type,
    '--count', '1',
    '--iam-instance-profile', `Name=${INSTANCE_ROLE}`,
    '--security-group-ids', group.GroupId,
    // Shutting it down from inside is one of the ways to be rid of it.
    '--instance-initiated-shutdown-behavior', 'terminate',
    // A t3 is "unlimited" by default and bills extra for a busy CPU, which a
    // desktop installing itself is. Standard slows it down instead.
    '--credit-specification', 'CpuCredits=standard',
    '--metadata-options', 'HttpTokens=required,HttpEndpoint=enabled',
    '--block-device-mappings', JSON.stringify([
      { DeviceName: ami.RootDeviceName, Ebs: { VolumeSize: disk, VolumeType: 'gp3', DeleteOnTermination: true } }
    ]),
    '--user-data', system.windows ? windowsUserData(password, expires) : linuxUserData(password, expires),
    '--tag-specifications', JSON.stringify([
      { ResourceType: 'instance', Tags: tags },
      { ResourceType: 'volume', Tags: tags }
    ])
  ]
  if (spot) {
    args.push('--instance-market-options', JSON.stringify({
      MarketType: 'spot',
      SpotOptions: { SpotInstanceType: 'one-time', InstanceInterruptionBehavior: 'terminate' }
    }))
  }
  const { Instances } = await awsPatiently(args, 'Invalid IAM Instance Profile')
  const id = Instances[0].InstanceId

  // The clock outside the machine, for when the one inside does not run: a hung
  // system, a timer lost to a reboot. Five minutes after the machine's own, so
  // normally that one has already done it.
  const at = new Date(expires.getTime() + 5 * 60_000).toISOString().slice(0, 19)
  try {
    await awsPatiently([
      'scheduler', 'create-schedule',
      '--name', scheduleName(id),
      '--schedule-expression', `at(${at})`,
      '--schedule-expression-timezone', 'UTC',
      '--flexible-time-window', 'Mode=OFF',
      '--action-after-completion', 'DELETE',
      '--target', JSON.stringify({
        Arn: 'arn:aws:scheduler:::aws-sdk:ec2:terminateInstances',
        RoleArn: scheduler.Role.Arn,
        Input: JSON.stringify({ InstanceIds: [id] }),
        RetryPolicy: { MaximumEventAgeInSeconds: 3600, MaximumRetryAttempts: 10 }
      })
    ], 'assume')
  } catch (err) {
    // An instance with only its own clock is the one that gets forgotten.
    aws(['ec2', 'terminate-instances', '--instance-ids', id])
    throw new Problem(`${err.message}\nwithout its outside timer, ${id} was terminated at once`)
  }

  console.log(`account          : ${Account}, ${REGION}`)
  console.log(`launched         : ${id}, ${system.name} on ${system.type}, ${spot ? 'spot' : 'on-demand'}`)
  console.log(`expires          : ${local(expires)}, in ${hours} h, whatever else happens`)
  console.log(`ready in about   : ${system.minutes} minutes`)
  console.log(`connect          : npm run lab -- connect ${id}`)
  console.log(`done early       : npm run lab -- down ${id}, or shut it down from inside`)
}

/** Only instances this lab launched; nothing else in the account is touched. */
function labInstances(ids) {
  const args = [
    'ec2', 'describe-instances',
    '--filters', `Name=tag:project,Values=${PROJECT}`, 'Name=instance-state-name,Values=pending,running,stopping,stopped,shutting-down'
  ]
  if (ids) args.push('--instance-ids', ...ids)
  return aws(args).Reservations.flatMap((reservation) => reservation.Instances)
}

function list() {
  const instances = labInstances()
  if (instances.length === 0) return console.log('no lab instances')
  for (const instance of instances) {
    const expires = new Date(tag(instance, 'expires'))
    const left = Math.round((expires.getTime() - Date.now()) / 60_000)
    console.log([
      instance.InstanceId,
      (tag(instance, 'system') ?? '?').padEnd(13),
      instance.State.Name.padEnd(13),
      instance.InstanceType.padEnd(10),
      (instance.InstanceLifecycle === 'spot' ? 'spot' : 'on-demand').padEnd(10),
      `expires ${local(expires)} (${left > 0 ? `${left} min left` : 'overdue'})`
    ].join(' '))
  }
}

async function runOn(id, system, script) {
  const { Command } = aws([
    'ssm', 'send-command',
    '--instance-ids', id,
    '--document-name', system.windows ? 'AWS-RunPowerShellScript' : 'AWS-RunShellScript',
    '--parameters', JSON.stringify({ commands: [script] })
  ])
  for (;;) {
    await sleep(3000)
    const invocation = aws(['ssm', 'get-command-invocation', '--command-id', Command.CommandId, '--instance-id', id], {
      quiet: ['InvocationDoesNotExist']
    })
    if (invocation && ['Success', 'Failed', 'Cancelled', 'TimedOut'].includes(invocation.Status)) {
      return invocation.StandardOutputContent.trim()
    }
  }
}

async function waitFor(what, ask, minutes) {
  process.stdout.write(`waiting for ${what} `)
  const deadline = Date.now() + minutes * 60_000
  while (Date.now() < deadline) {
    if (await ask()) return process.stdout.write('\n')
    process.stdout.write('.')
    await sleep(10_000)
  }
  throw new Problem(`\n${what} did not happen within ${minutes} minutes`)
}

async function connect(id) {
  if (!id) throw new Problem('connect to which instance? npm run lab -- list')
  const [instance] = labInstances([id])
  if (!instance || !['pending', 'running'].includes(instance.State.Name)) {
    throw new Problem(`${id} is not a running lab instance`)
  }
  const system = SYSTEMS[tag(instance, 'system')]
  if (spawnSync('session-manager-plugin', ['--version']).error) {
    throw new Problem('the tunnel needs the Session Manager plugin: brew install --cask session-manager-plugin')
  }

  await waitFor('the instance to reach Session Manager', () => {
    const [info] = aws(['ssm', 'describe-instance-information', '--filters', `Key=InstanceIds,Values=${id}`]).InstanceInformationList
    return info?.PingStatus === 'Online'
  }, 15)

  await waitFor('the desktop to be ready', async () => {
    const answer = await runOn(id, system, system.windows
      ? `if (Test-Path '${WINDOWS_READY}') { 'ready' } else { 'waiting' }`
      : `if [ -f ${LINUX_READY} ]; then echo ready; else cloud-init status || true; fi`)
    if (answer.includes('status: error')) {
      throw new Problem(`\nthe desktop failed to install. Its log: aws ssm start-session --target ${id} --region ${REGION}, then sudo less /var/log/cloud-init-output.log`)
    }
    return answer === 'ready'
  }, 25)

  // Read back from the instance's own user data rather than kept on this disk.
  const { UserData } = aws(['ec2', 'describe-instance-attribute', '--instance-id', id, '--attribute', 'userData'])
  const password = Buffer.from(UserData.Value, 'base64').toString('utf8').match(/password\s*=\s*'([^']+)'/)?.[1]
  const port = await localPort()
  const expires = new Date(tag(instance, 'expires'))

  console.log(`\n${system.name}, until ${local(expires)}`)
  console.log(`Windows App → Add PC → localhost:${port}`)
  console.log(`user             : ${system.user}`)
  // On the clipboard rather than on the screen: a terminal keeps its scrollback,
  // and whatever records a session records the password along with it.
  if (!password) console.log('password         : not found in the instance user data')
  else if (toClipboard(password)) console.log('password         : on the clipboard, to paste when Windows App asks')
  else {
    console.log('password         : no clipboard here; read it with')
    console.log(`  aws ec2 describe-instance-attribute --instance-id ${id} --attribute userData --region ${REGION} --query UserData.Value --output text | base64 --decode | grep password`)
  }
  console.log('Ctrl+C closes the tunnel.\n')

  const tunnel = spawn('aws', [
    'ssm', 'start-session',
    '--target', id,
    '--document-name', 'AWS-StartPortForwardingSession',
    '--parameters', JSON.stringify({ portNumber: ['3389'], localPortNumber: [String(port)] }),
    '--region', REGION
  ], { stdio: 'inherit' })
  // Ctrl+C is for the tunnel; this process stays to ask what comes next.
  const ignore = () => {}
  process.on('SIGINT', ignore)
  await new Promise((resolve) => tunnel.on('exit', resolve))
  process.off('SIGINT', ignore)

  if (!process.stdin.isTTY) return
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout })
  const answer = await prompt.question(`\nTunnel closed. Terminate ${id} now? [y/N] `)
  prompt.close()
  if (/^y/i.test(answer.trim())) await down([id])
  else console.log(`left running until ${local(expires)}: npm run lab -- down ${id} when you are done`)
}

/** The first clipboard this machine has; false when it has none. */
function toClipboard(text) {
  const tools = {
    darwin: [['pbcopy']],
    win32: [['clip']],
    linux: [['wl-copy'], ['xclip', '-selection', 'clipboard']]
  }[process.platform] ?? []
  return tools.some(([command, ...args]) => {
    const result = spawnSync(command, args, { input: text })
    return !result.error && result.status === 0
  })
}

async function localPort() {
  for (let port = 13389; port < 13400; port++) {
    const free = await new Promise((resolve) => {
      const server = net.createServer()
      server.once('error', () => resolve(false))
      server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)))
    })
    if (free) return port
  }
  throw new Problem('ports 13389 to 13399 are all taken on this machine')
}

async function down(ids) {
  if (ids.length === 0) throw new Problem('terminate which instance? Name one, or --all')
  const all = ids.includes('--all')
  const instances = all ? labInstances() : labInstances(ids)
  if (!all) {
    const strangers = ids.filter((id) => !instances.some((instance) => instance.InstanceId === id))
    if (strangers.length > 0) {
      throw new Problem(`not lab instances, or already gone: ${strangers.join(', ')}. Nothing was terminated`)
    }
  }
  if (instances.length === 0) return console.log('no lab instances to terminate')

  const found = instances.map((instance) => instance.InstanceId)
  aws(['ec2', 'terminate-instances', '--instance-ids', ...found])
  for (const id of found) {
    aws(['scheduler', 'delete-schedule', '--name', scheduleName(id)], { quiet: ['ResourceNotFoundException'] })
  }
  console.log(`terminating      : ${found.join(', ')}`)
  aws(['ec2', 'wait', 'instance-terminated', '--instance-ids', ...found])
  // Terminated, not stopped: a stopped instance still pays for its disk.
  console.log('TERMINATED, and the disks went with them')
}

const USAGE = `usage:
  npm run lab -- setup
  npm run lab -- up <${Object.keys(SYSTEMS).join('|')}> [--hours 3] [--spot]
  npm run lab -- connect <instance>
  npm run lab -- list
  npm run lab -- down <instance…> | --all`

try {
  const [command, ...rest] = process.argv.slice(2)
  const option = (name, fallback) => {
    const at = rest.indexOf(name)
    return at === -1 ? fallback : rest.splice(at, 2)[1]
  }
  const flag = (name) => {
    const at = rest.indexOf(name)
    return at !== -1 && rest.splice(at, 1).length === 1
  }

  if (command === 'setup') setup()
  else if (command === 'up') {
    const hours = Number(option('--hours', '3'))
    const spot = flag('--spot')
    await up(rest[0], { hours, spot })
  } else if (command === 'connect') await connect(rest[0])
  else if (command === 'list') list()
  else if (command === 'down') await down(rest)
  else throw new Problem(USAGE)
} catch (err) {
  console.error(err instanceof Problem ? `PROBLEMS: ${err.message}` : err)
  process.exitCode = 1
}
