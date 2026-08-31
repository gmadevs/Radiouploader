# Install and sign in

::: danger The app never tells you your images are clean
It looks for burnt-in text before anonymising and rings what it finds, but it finds the
obvious banners and misses small print, text over anatomy and anything on the images it did
not read. Look at every frame yourself, and read [known limitations](/limitations) before
you point it at a study you care about.
:::

Radiouploader runs on macOS, Linux and Windows. The current version of each is linked from
the [home page](/), and every build of every version is attached to its
[release](https://github.com/gmadevs/Radiouploader/releases); nothing is signed, so the
first launch needs one extra step:

| Platform | First launch |
|---|---|
| **macOS** | Gatekeeper refuses an unsigned dmg: right-click → Open, or `xattr -dr com.apple.quarantine /Applications/Radiouploader.app` |
| **Windows** | SmartScreen warns until the binary builds reputation: More info → Run anyway |
| **Linux** | `chmod +x` the AppImage, or install the deb |

Signing needs an Apple Developer ID ($99/year) and an Authenticode certificate. Neither is
in place — see [packaging](/develop/packaging). That is what the extra step is for; it says
nothing about what the app does once it is open.

## Register an application

The app talks to Radiopaedia as **you**, with credentials you register yourself. Go to
[radiopaedia.org/oauth/applications/new](https://radiopaedia.org/oauth/applications/new):

- **Redirect URI**: `urn:ietf:wg:oauth:2.0:oob`
- **Scope**: leave it empty

Radiopaedia's form requires an https redirect URI and rejects a plain `http://127.0.0.1:…`
loopback, so the usual RFC 8252 native-app pattern cannot be registered at all. The
out-of-band URN is what their form points at: the app opens the authorization page in your
browser, Radiopaedia shows you a code, and you paste it back. PKCE is sent either way.

::: warning Do not request a scope
The API reference never passes a `scope` parameter and neither does Radiopaedia's own
uploader — permitted scopes are declared on the application itself. Asking for one
explicitly answers *"The requested scope is invalid, unknown, or malformed"*.
:::

If you do register an https redirect URI, the app notices and uses a loopback listener
instead, with no code to copy.

## Sign in

Paste the Application ID and secret into the sign-in panel in the app header. Tokens are
stored encrypted through the OS keychain — Keychain on macOS, libsecret on Linux, DPAPI on
Windows — and never written in the clear.

The draft-case quota is read at sign-in and shown next to your username. It is what blocks
importing when the account is full, before you spend time on a study you could not upload.

## Handing a build to someone else

**No credentials are compiled into the app.** The Application ID and secret are entered at
runtime and stored per user, so a build can go to anyone without sharing yours — each
person registers their own application and signs in to their own account.

Do not embed your own credentials to save them that step. A client secret shipped inside a
desktop binary is trivially extractable and stops being a secret
([RFC 8252 §8.5](https://datatracker.ietf.org/doc/html/rfc8252#section-8.5)); any
per-application rate limit would then be shared by every user, and one revocation would
break every install. If the application form offers a *Confidential* checkbox, unticking it
creates a public client with no secret — client ids are not secret, so that variant could
ship embedded and rely on PKCE alone, which this app already sends.
