/**
 * Install a package the way somebody downloading it would, open the app that
 * install left behind, and take it away again. Run by the install job in
 * .github/workflows/build.yml, one phase per step:
 *
 *   node scripts/installed.mjs <dmg|nsis|deb|appimage> <install|launch|uninstall> <dir>
 *
 * `npm run smoke` proves out/ boots under the development Electron. This proves
 * the thing people download does: that the deb declares what the binary links
 * against, that Windows can remove what the installer put there, that the asar
 * carries what the bundle needs.
 *
 * The app is checked from outside, over the DevTools protocol, with nothing
 * added to it — the same rule the screenshots keep.
 */
import fs from 'node:fs'
import os from 'node:os'
import net from 'node:net'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { ASSETS, version } from './downloads.mjs'

const PRODUCT = 'Radiouploader'
const [format, phase, dir] = process.argv.slice(2)

class Problem extends Error {}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Keep asking until the answer is truthy or the time is up; undefined if it never was. */
async function until(ask, ms) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const answer = await ask()
    if (answer) return answer
    await sleep(500)
  }
  return undefined
}

function run(command, args, options = {}) {
  console.log(`$ ${[command, ...args].join(' ')}`)
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error) throw new Problem(`${command}: ${result.error.message}`)
  if (result.status !== 0) throw new Problem(`${command} exited with ${result.status}`)
}

function read(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.error) throw new Problem(`${command}: ${result.error.message}`)
  return result
}

/**
 * The machine's architecture rather than this Node's. A Node built for Intel
 * runs under Rosetta on Apple silicon and reports x64 there, and would have the
 * Intel dmg tested — and passed — on a Mac nobody would download it for.
 */
function machineArch() {
  const translated = process.platform === 'darwin' && read('sysctl', ['-in', 'sysctl.proc_translated']).stdout.trim()
  return translated === '1' ? 'arm64' : process.arch
}

/**
 * The file this platform would download, by the name the download links give
 * it. Looked up rather than globbed for, so a build that renames an artifact
 * fails here instead of on the front page.
 */
function installer() {
  const names = {
    dmg: { arm64: ASSETS.macArm, x64: ASSETS.macIntel },
    nsis: { x64: ASSETS.windows },
    deb: { arm64: ASSETS.debArm, x64: ASSETS.deb },
    appimage: { arm64: ASSETS.appImageArm, x64: ASSETS.appImage }
  }[format]
  const name = names[machineArch()]
  if (!name) throw new Problem(`nobody downloads a ${format} for ${machineArch()}`)
  // GitHub turns spaces in an asset's name into dots when the release takes it,
  // so NSIS's "Radiouploader Setup 1.3.1.exe" is downloaded as
  // "Radiouploader.Setup.1.3.1.exe". Straight from a build it still has spaces.
  const files = fs.readdirSync(dir)
  const found = files.find((file) => file.replaceAll(' ', '.') === name(version))
  if (!found) throw new Problem(`${name(version)} is not in ${dir}, which holds: ${files.join(', ')}`)
  return path.resolve(dir, found)
}

// Not /Applications: where the app sits changes nothing about whether it opens,
// and a run on a Mac that has the real app installed must not replace it.
const APPLICATIONS = path.join(os.tmpdir(), 'radiouploader-installed')

const macOS = {
  install() {
    const mount = fs.mkdtempSync(path.join(os.tmpdir(), 'radiouploader-dmg-'))
    run('hdiutil', ['attach', installer(), '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mount])
    try {
      const apps = fs.readdirSync(mount).filter((name) => name.endsWith('.app'))
      if (apps.length !== 1 || apps[0] !== `${PRODUCT}.app`) {
        throw new Problem(`the disk image should hold ${PRODUCT}.app and holds: ${apps.join(', ') || 'no app'}`)
      }
      fs.rmSync(APPLICATIONS, { recursive: true, force: true })
      fs.mkdirSync(APPLICATIONS)
      // ditto, as the Finder does: cp -R flattens the symlinks inside the
      // frameworks, and an app copied that way is not the app a user has.
      run('ditto', [path.join(mount, apps[0]), path.join(APPLICATIONS, apps[0])])
    } finally {
      run('hdiutil', ['detach', mount])
      fs.rmdirSync(mount)
    }

    // Quarantine is not tested and cannot be: an artifact the runner downloaded
    // carries no mark, and Gatekeeper's answer to one that did is a dialog.
    const { exe } = macOS.locate()
    const archs = read('lipo', ['-archs', exe]).stdout.trim().split(/\s+/)
    const expected = machineArch() === 'arm64' ? 'arm64' : 'x86_64'
    // The two dmgs differ by one word in their names. One holding the other's
    // binary opens under Rosetta on Apple silicon, and nobody would notice.
    if (!archs.includes(expected)) {
      throw new Problem(`${path.basename(installer())} holds a binary for ${archs.join(' + ')}, not ${expected}`)
    }
    console.log(`architectures  : ${archs.join(' + ')}`)
  },

  locate() {
    const app = path.join(APPLICATIONS, `${PRODUCT}.app`)
    const plist = path.join(app, 'Contents', 'Info.plist')
    if (!fs.existsSync(plist)) throw new Problem(`${app} is not there; the install phase runs first`)
    const executable = read('plutil', ['-extract', 'CFBundleExecutable', 'raw', '-o', '-', plist]).stdout.trim()
    return { exe: path.join(app, 'Contents', 'MacOS', executable) }
  }
}

/** What Apps & features lists for this app, read the way Windows reads it. */
function uninstallEntry() {
  const script =
    `ConvertTo-Json -Compress -InputObject @(` +
    `Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue |` +
    ` Where-Object { $_.DisplayName -like '${PRODUCT}*' } |` +
    ` Select-Object DisplayName, DisplayIcon, QuietUninstallString)`
  const result = read('powershell', ['-NoProfile', '-NonInteractive', '-Command', script])
  if (result.status !== 0) throw new Problem(`reading the registry failed: ${result.stderr}`)
  const entries = JSON.parse(result.stdout.trim() || '[]')
  if (entries.length > 1) throw new Problem(`${entries.length} entries are called ${PRODUCT}`)
  return entries[0]
}

const startMenuShortcut = () =>
  path.join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', `${PRODUCT}.lnk`)

const windows = {
  install() {
    // Silent, and per user as the one-click installer is by default, so nothing
    // asks to elevate.
    run(installer(), ['/S'])
    const { exe, entry } = windows.locate()
    if (!fs.existsSync(startMenuShortcut())) throw new Problem(`no Start menu shortcut at ${startMenuShortcut()}`)
    console.log(`Apps & features: ${entry.DisplayName}`)
    console.log(`installed at   : ${exe}`)
  },

  locate() {
    const entry = uninstallEntry()
    if (!entry) throw new Problem(`nothing called ${PRODUCT} is registered to uninstall`)
    // Written by the installer as the executable's path followed by ",0".
    const exe = entry.DisplayIcon.replace(/,\d+$/, '').replace(/^"|"$/g, '')
    if (!fs.existsSync(exe)) throw new Problem(`the uninstall entry names ${exe}, which is not there`)
    return { exe, entry }
  },

  async uninstall() {
    const { exe, entry } = windows.locate()
    run(entry.QuietUninstallString, [], { shell: true })
    // The NSIS uninstaller copies itself out of the folder it is about to delete
    // and runs from there, so the command returns before the work is done.
    const left = () =>
      [
        uninstallEntry() && 'the Apps & features entry',
        fs.existsSync(exe) && exe,
        fs.existsSync(startMenuShortcut()) && startMenuShortcut()
      ].filter(Boolean)
    if (!(await until(() => left().length === 0, 60_000))) {
      throw new Problem(`uninstalled, but left behind: ${left().join(', ')}`)
    }
  }
}

function asRoot(command, args) {
  // Through env so the variable survives sudo, which resets the environment.
  const line = ['env', 'DEBIAN_FRONTEND=noninteractive', command, ...args]
  if (process.getuid() === 0) run(line[0], line.slice(1))
  else run('sudo', line)
}

const exists = (file) => {
  try {
    fs.lstatSync(file)
    return true
  } catch {
    return false
  }
}

const debian = {
  install() {
    // apt rather than dpkg -i: apt fetches what the package says it depends on,
    // and that claim is what is under test. In a bare container nothing else has
    // put those libraries there first.
    asRoot('apt-get', ['update', '-q'])
    asRoot('apt-get', ['install', '-y', '-q', installer()])

    const { exe, pkg, link } = debian.locate()
    // ldd sees only what is linked, not what is opened later, but a library
    // missing here is one the app cannot start without.
    const missing = read('ldd', [exe]).stdout.split('\n').filter((line) => line.includes('not found'))
    if (missing.length > 0) {
      throw new Problem(`installed, but ${pkg} did not bring what the binary links against:\n${missing.join('\n')}`)
    }
    if (!exists(link)) throw new Problem(`no ${link}, so typing the name in a terminal finds nothing`)

    // Which of the two sandboxes the post-install script chose. Said rather than
    // checked: it depends on the kernel the package landed on.
    const setuid = (fs.statSync(path.join(path.dirname(exe), 'chrome-sandbox')).mode & 0o4000) !== 0
    console.log(`installed at   : ${exe}`)
    console.log(`sandbox        : ${setuid ? 'setuid chrome-sandbox' : 'user namespaces'}`)
    console.log(`AppArmor       : ${exists(`/etc/apparmor.d/${pkg}`) ? 'profile installed' : 'no profile'}`)
  },

  locate() {
    const pkg = read('dpkg-deb', ['-f', installer(), 'Package']).stdout.trim()
    const status = read('dpkg-query', ['-W', '-f=${db:Status-Status}', pkg]).stdout.trim()
    if (status !== 'installed') throw new Problem(`${pkg} is not installed (${status || 'unknown to dpkg'})`)
    const desktop = read('dpkg', ['-L', pkg])
      .stdout.split('\n')
      .find((file) => /^\/usr\/share\/applications\/[^/]+\.desktop$/.test(file))
    if (!desktop) throw new Problem(`${pkg} installed no .desktop file, so no menu will list it`)
    // The binary is taken from the menu entry, since that is how people start it.
    const execLine = fs.readFileSync(desktop, 'utf8').split('\n').find((line) => line.startsWith('Exec='))
    const exe = execLine?.slice('Exec='.length).match(/^"([^"]+)"|^(\S+)/)?.slice(1).find(Boolean)
    if (!exe || !fs.existsSync(exe)) throw new Problem(`${desktop} starts ${exe ?? 'nothing'}, which is not there`)
    return { exe, pkg, desktop, link: `/usr/bin/${path.basename(exe)}` }
  },

  uninstall() {
    const { exe, pkg, desktop, link } = debian.locate()
    asRoot('apt-get', ['remove', '-y', '-q', pkg])
    const status = read('dpkg-query', ['-W', '-f=${db:Status-Status}', pkg]).stdout.trim()
    if (status === 'installed') throw new Problem(`apt removed ${pkg} and dpkg still calls it installed`)
    const left = [exe, desktop, link].filter(exists)
    if (left.length > 0) throw new Problem(`removed, but left behind: ${left.join(', ')}`)
  }
}

const appImage = {
  install() {
    // The whole of installing one, as the guide says.
    fs.chmodSync(installer(), 0o755)
    console.log(`installed at   : ${installer()}`)
  },

  locate() {
    const exe = installer()
    if ((fs.statSync(exe).mode & 0o100) === 0) throw new Problem(`${exe} is not executable; the install phase runs first`)
    return { exe }
  }
}

const FORMATS = { dmg: macOS, nsis: windows, deb: debian, appimage: appImage }

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    const pending = new Map()
    const listeners = []
    let next = 0
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id === undefined) return listeners.forEach((listener) => listener(message))
      const call = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) call.reject(new Problem(`${call.method}: ${message.error.message}`))
      else call.resolve(message.result)
    })
    socket.addEventListener('error', () => reject(new Problem(`could not reach DevTools at ${url}`)))
    socket.addEventListener('open', () =>
      resolve({
        send: (method, params = {}) =>
          new Promise((resolve, reject) => {
            const id = ++next
            pending.set(id, { resolve, reject, method })
            socket.send(JSON.stringify({ id, method, params }))
          }),
        on: (listener) => listeners.push(listener),
        close: () => socket.close()
      })
    )
  })
}

function within(promise, ms, what) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Problem(`${what} took longer than ${ms / 1000} s`)), ms)
  })
  // Cleared, or the losing timeout rejects later with nobody listening.
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

async function launch() {
  const { exe } = FORMATS[format].locate()
  const args = []
  if (process.platform === 'linux' && process.getuid() === 0) {
    // Chromium will not start as root with its sandbox on, and root is who runs
    // everything in a container. A run here says the package installs and the
    // app boots; the jobs outside a container are the ones that test the sandbox.
    args.push('--no-sandbox')
    console.log('running as root, so with --no-sandbox: this run says nothing about the sandbox')
  }
  if (process.platform === 'linux') {
    // Ubuntu 24.04 lets only programs AppArmor names use user namespaces, which
    // is what the sandbox needs. A pass means something different on a machine
    // where that restriction was turned off, so the log says which this was.
    const restrict = '/proc/sys/kernel/apparmor_restrict_unprivileged_userns'
    const value = fs.existsSync(restrict) ? fs.readFileSync(restrict, 'utf8').trim() : 'absent'
    console.log(`userns restricted by AppArmor: ${value}`)
  }

  const port = await freePort()
  // A profile of its own: a first launch, and nothing read from or written to
  // the settings or keychain of whoever runs this on their own machine.
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'radiouploader-profile-'))
  const child = spawn(exe, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    // A group of its own, so the whole tree can be stopped: an AppImage is a
    // runtime with the app as its child, and killing the runtime alone orphans it.
    detached: process.platform !== 'win32'
  })
  let output = ''
  const keep = (data) => (output = (output + data).slice(-64_000))
  child.stdout.on('data', keep)
  child.stderr.on('data', keep)
  let exited
  child.on('exit', (code, signal) => (exited = `exit ${code ?? signal}`))
  child.on('error', (err) => (exited = err.message))

  const problems = []
  let cdp
  try {
    const page = await until(async () => {
      if (exited) throw new Problem(`the app quit before opening a window (${exited})\n${output}`)
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`)
        .then((response) => response.json())
        .catch(() => [])
      return targets.find((target) => target.type === 'page' && target.url.startsWith('file:'))
    }, 90_000)
    if (!page) throw new Problem(`no window after 90 s\n${output}`)

    cdp = await connect(page.webSocketDebuggerUrl)
    cdp.on(({ method, params }) => {
      if (method === 'Runtime.consoleAPICalled' && ['error', 'assert'].includes(params.type)) {
        problems.push(`console: ${params.args.map((arg) => arg.value ?? arg.description ?? '').join(' ')}`)
      } else if (method === 'Runtime.exceptionThrown') {
        const details = params.exceptionDetails
        problems.push(`exception: ${details.exception?.description ?? details.text}`)
      } else if (method === 'Log.entryAdded' && params.entry.level === 'error') {
        problems.push(`log: ${params.entry.text}${params.entry.url ? ` (${params.entry.url})` : ''}`)
      } else if (method === 'Inspector.targetCrashed') {
        problems.push('the renderer crashed')
      }
    })
    // Both hand over what the page logged before anyone was listening, which is
    // most of what a start-up logs.
    await cdp.send('Runtime.enable')
    await cdp.send('Log.enable')
    await cdp.send('Inspector.enable')

    const evaluate = async (expression) =>
      (await cdp.send('Runtime.evaluate', { expression, returnByValue: true })).result.value
    await until(() => evaluate(`document.readyState === 'complete' && !!document.querySelector('#root')?.firstChild`), 30_000)
    // As long as the smoke test gives it, for whatever the first effects log.
    await sleep(3000)
    const state = await evaluate(`({
      root: !!document.querySelector('#root')?.firstChild,
      steps: [...document.querySelectorAll('.step')].map((e) => e.textContent.trim()),
      bridge: typeof window.api?.ingest
    })`)

    const shot = path.resolve(process.env.INSTALLED_SCREENSHOT ?? 'installed.png')
    try {
      const { data } = await within(cdp.send('Page.captureScreenshot', { format: 'png' }), 15_000, 'the screenshot')
      fs.writeFileSync(shot, Buffer.from(data, 'base64'))
    } catch (err) {
      // Evidence rather than the check, so its absence is said and not failed on.
      console.log(`screenshot     : none, ${err.message}`)
    }

    console.log(`launched       : ${exe}`)
    console.log(`renderer mounted: ${state.root}`)
    console.log(`wizard steps   : ${JSON.stringify(state.steps)}`)
    console.log(`preload bridge : ${state.bridge}`)
    if (fs.existsSync(shot)) console.log(`screenshot     : ${shot}`)

    if (exited) problems.push(`the app quit while it was being checked (${exited})`)
    if (!state.root) problems.push('the renderer did not mount')
    if (state.bridge !== 'function') problems.push('the preload bridge is missing')
    if (problems.length > 0) throw new Problem(`${problems.join('\n')}\n--- the app's own output ---\n${output}`)
  } finally {
    cdp?.close()
    await stop(child)
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
  }
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const gone = new Promise((resolve) => child.once('exit', () => resolve(true)))
  const signal = (name) => {
    try {
      process.kill(-child.pid, name)
    } catch {
      // Already gone.
    }
  }
  // The whole tree on Windows too: a renderer left running holds files open,
  // and the uninstall that follows cannot delete them.
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'])
  else signal('SIGTERM')
  if (!(await Promise.race([gone, sleep(10_000)]))) {
    signal('SIGKILL')
    await gone
  }
}

try {
  if (!FORMATS[format] || !['install', 'launch', 'uninstall'].includes(phase) || !dir) {
    throw new Problem('usage: node scripts/installed.mjs <dmg|nsis|deb|appimage> <install|launch|uninstall> <dir>')
  }
  if (phase === 'launch') await launch()
  else if (!FORMATS[format][phase]) {
    // Dragging an app to the Bin, deleting an AppImage: nothing is left that a
    // test could look for.
    throw new Problem(`a ${format} has nothing to uninstall but the file itself`)
  } else await FORMATS[format][phase]()
  console.log(`${format.toUpperCase()} ${phase.toUpperCase()} OK`)
} catch (err) {
  console.error(err instanceof Problem ? `PROBLEMS: ${err.message}` : err)
  process.exitCode = 1
}
// A child that ignored every signal would otherwise keep this process waiting on its pipes.
process.exit()
