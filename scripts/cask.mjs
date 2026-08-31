/**
 * The Homebrew cask for the macOS builds, written from what a release actually
 * contains.
 *
 * There is no cask in homebrew-cask, and there cannot be one yet: that
 * repository asks a project to be notable before it will carry it — thirty days
 * old at the least, and stars or forks or watchers in numbers this does not
 * have. So the cask lives in a tap of its own, `gmadevs/homebrew-radiouploader`,
 * which anyone can add in one command and which nobody has to review.
 *
 * The quarantine is not removed here. Homebrew has no `--no-quarantine` any
 * more, and a cask can still strip the attribute in a postflight — this one
 * does not: waiving Gatekeeper on an unsigned binary is a decision for the
 * person installing it, so the caveats ask for it in one line they can read.
 *
 * The version and the two checksums are the whole of what changes between
 * releases, and all three are read off the files rather than typed: the
 * workflow downloads the disk images the release published and hashes them.
 * A cask with a stale sha256 does not install, and says so in a way that
 * sounds like a compromised download rather than like a forgotten step.
 *
 * Run with: node scripts/cask.mjs <version> <arm64 sha256> <x64 sha256>
 */
import { REPO, downloads } from './downloads.mjs'

const [version, armSha, intelSha] = process.argv.slice(2)

if (!version || !armSha || !intelSha) {
  console.error('PROBLEMS: usage: node scripts/cask.mjs <version> <arm64 sha256> <x64 sha256>')
  process.exit(1)
}
for (const [name, sha] of [['arm64', armSha], ['x64', intelSha]]) {
  if (!/^[0-9a-f]{64}$/.test(sha)) {
    console.error(`PROBLEMS: the ${name} sha256 is not 64 hex characters: ${sha}`)
    process.exit(1)
  }
}

/**
 * One URL with two holes in it, which is how a cask carries both architectures.
 * `#{version}` and `#{arch}` are Ruby's, filled in when Homebrew reads the cask.
 */
const URL_TEMPLATE = `${REPO}/releases/download/v#{version}/Radiouploader-#{version}#{arch}.dmg`

/**
 * The names electron-builder gives the two disk images live in
 * `scripts/downloads.mjs`, where the README and the documentation home page
 * read them too. This template cannot read them — it has to keep Ruby's holes
 * in it — so it is checked against them instead: expand it here and it must
 * produce, character for character, the URLs the download buttons point at.
 */
const expand = (arch) => URL_TEMPLATE.replaceAll('#{version}', version).replace('#{arch}', arch)
const mac = downloads(version).platforms.find((platform) => platform.id === 'mac')
const expected = [
  [expand('-arm64'), mac.primary.url],
  [expand(''), mac.others.find((other) => other.label === 'Intel').url]
]
for (const [built, wanted] of expected) {
  if (built !== wanted) {
    console.error(`PROBLEMS: the cask would point at ${built}\n          the release publishes ${wanted}`)
    process.exit(1)
  }
}

process.stdout.write(`cask "radiouploader" do
  arch arm: "-arm64"

  version "${version}"
  sha256 arm:   "${armSha}",
         intel: "${intelSha}"

  url "${URL_TEMPLATE}",
      verified: "github.com/gmadevs/Radiouploader/"
  name "Radiouploader"
  desc "Prepares DICOM studies and uploads them to Radiopaedia as draft cases"
  homepage "${REPO}"

  livecheck do
    url :url
    strategy :github_latest
  end

  # Electron 43 sets this in the app itself; a cask that installs on an older
  # macOS installs something that will not start.
  depends_on macos: :monterey

  app "Radiouploader.app"

  # The tokens are in the login keychain, which no cask may empty: remove the
  # "Radiouploader" entry in Keychain Access by hand if you want them gone.
  zap trash: [
    "~/Library/Application Support/Radiouploader",
    "~/Library/Caches/io.github.gmadevs.radiouploader",
    "~/Library/Preferences/io.github.gmadevs.radiouploader.plist",
    "~/Library/Saved Application State/io.github.gmadevs.radiouploader.savedState",
  ]

  caveats <<~EOS
    Radiouploader is not signed with an Apple Developer ID, and Homebrew marks
    what it downloads, so macOS will refuse the first launch. Take the mark off:

      xattr -dr com.apple.quarantine \#{appdir}/Radiouploader.app

    Or leave it, let macOS block the app once, and allow it in System Settings ->
    Privacy & Security (on macOS 14 and earlier, Control-click -> Open).

    The app never tells you your images are clean: it looks for burnt-in text
    before anonymising and rings what it finds, but it misses small print and
    text over anatomy. Look at every frame yourself, and read
    https://gmadevs.github.io/Radiouploader/limitations first.
  EOS
end
`)
