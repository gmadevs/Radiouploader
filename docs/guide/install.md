# Install and sign in

::: danger Check every image yourself
Before anonymising, the app marks areas that look like burnt-in text. It finds large
banners and can miss small print, text over anatomy and text on images it did not examine.
It never reports a study as free of burnt-in text. Look at every frame before uploading, and
read [known limitations](/limitations) first.
:::

Radiouploader runs on macOS, Linux and Windows. The current installers are linked from the
[home page](/), and every version is on the
[releases page](https://github.com/gmadevs/Radiouploader/releases).

The installers are not signed, so the first launch needs one extra step:

| Platform | First launch |
|---|---|
| macOS | Run `xattr -dr com.apple.quarantine /Applications/Radiouploader.app`, or allow the app in System Settings → Privacy & Security (on macOS 14 and earlier, Control-click the app and choose Open). |
| Windows | SmartScreen shows a warning: choose More info → Run anyway. |
| Linux | Make the AppImage executable with `chmod +x`, or install the deb. The AppImage needs FUSE 2, which Ubuntu does not install by default: `sudo apt install libfuse2t64` on 24.04, `sudo apt install libfuse2` on 22.04. |

Signing would need an Apple Developer ID and a Windows code-signing certificate, which the
project does not have. See [packaging](/develop/packaging#signing).

## macOS with Homebrew {#macos-with-homebrew}

```bash
brew install --cask gmadevs/radiouploader/radiouploader
xattr -dr com.apple.quarantine /Applications/Radiouploader.app
```

The first command adds the project's tap, downloads the disk image for your Mac's
architecture, checks it against the checksum in the cask and installs the app in
`/Applications`.

The second command removes the quarantine flag that Homebrew adds to everything it
downloads. macOS blocks an unsigned app that has the flag, so without this step the app
does not open. The cask does not remove the flag itself, because that is a decision for the
person installing the app.

If you prefer to keep the flag, skip the second command and let macOS block the app once.
Then, on macOS 14 and earlier, Control-click the app and choose **Open**; on macOS 15 and
later, go to **System Settings → Privacy & Security** and choose **Open Anyway**.

To remove the app and its settings, run `brew uninstall --cask --zap radiouploader`.

The cask is published in the project's own tap,
[gmadevs/homebrew-radiouploader](https://github.com/gmadevs/homebrew-radiouploader), and is
updated automatically when a release is published.

::: tip Removing your sign-in
`--zap` removes `~/Library/Application Support/Radiouploader` and the app's preferences, but
not your Radiopaedia tokens, which are in the login keychain. Sign out in the app first
(click your account name in the header, then **Sign out**), or delete the *Radiouploader*
entry in Keychain Access.
:::

## Updates

At launch the app checks GitHub for the latest release number. If a newer version exists, the
home screen shows a notice. The app does not download or install anything itself.

If you installed with Homebrew, the notice shows the commands to update:

```bash
brew upgrade --cask radiouploader
xattr -dr com.apple.quarantine /Applications/Radiouploader.app
```

The second command is needed again, because Homebrew adds the quarantine flag to every
download. If you installed from the disk image, the notice links to the releases page
instead.

**Not now** hides the notice until a newer version is released. To turn the check off, open
**Info** and clear **Look for a newer version at launch**. The check sends no information
about you, your account or your studies. If GitHub cannot be reached, the app shows nothing.

## Register an application

The app connects to Radiopaedia with an OAuth application that you register under your own
account. Go to
[radiopaedia.org/oauth/applications/new](https://radiopaedia.org/oauth/applications/new) and
set:

- **Redirect URI**: `urn:ietf:wg:oauth:2.0:oob`
- **Scope**: leave empty

Radiopaedia requires an https redirect URI or this out-of-band address; it does not accept a
local `http://127.0.0.1` address. With the out-of-band address, Radiopaedia shows you a code
after you authorise the app, and you paste the code into the app.

::: warning Leave the scope empty
The scopes are set on the application itself. If you enter a scope in the app, Radiopaedia
answers *"The requested scope is invalid, unknown, or malformed"*.
:::

If you registered an https redirect URI instead, Radiopaedia sends your browser to that
address with the code in it. Paste the whole address into the code field, and the app reads
the code from it.

## Sign in

1. Click **Sign in to Radiopaedia** in the header.
2. Enter the **Application ID** and, if your application has one, the **Client secret**.
3. Click **Open Radiopaedia to authorise**. Your browser opens Radiopaedia's authorisation
   page.
4. Authorise the application, copy the code Radiopaedia shows, paste it into the app and
   click **Complete sign in**.

If the app cannot open a browser (for example on a minimal Linux system without `xdg-open`),
it shows the address with a **Copy the address** button. Open the address in any browser and
continue from step 4. The same button is shown if the browser was asked to open but no window
appeared. Other links the app opens, such as release notes or your case on Radiopaedia,
behave the same way.

Your tokens are stored encrypted in the system keychain: Keychain on macOS, libsecret on
Linux and DPAPI on Windows.

After you sign in, the header shows your username and how many of your draft cases are in
use. When the draft quota is full, you can still import a study and add it to a draft you
already have, but you cannot create a new case.

If the app shows **Radiopaedia credentials aren't set yet**, click **Enter credentials** to
open the sign-in panel. To sign out, click your account name in the header, then **Sign out**.

## Using the app on another computer

The Application ID and secret are not built into the app. Each person registers their own
application and signs in to their own account, so an installer can be given to anyone.

Do not add your own credentials to a build to save others this step. A client secret inside
a desktop app can be extracted by anyone who has the app
([RFC 8252 §8.5](https://datatracker.ietf.org/doc/html/rfc8252#section-8.5)), every user
would share your application's rate limit, and revoking it would stop every copy from
working. If Radiopaedia's form offers a *Confidential* checkbox, clearing it creates a public
application without a secret; the app supports that, because it always uses PKCE.
