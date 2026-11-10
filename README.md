# StreamLock

A macOS menu bar app (Electron + React + TypeScript) that keeps one PIN in sync
across Netflix, Disney+, Hulu, HBO Max, Paramount+, Peacock, Prime Video,
Discovery+, Plex and The Roku Channel. By default the PIN is **MMYY**
(October 2026 → `1026`) and changes on the 1st of each month.

Only services whose PIN can be changed on their own website are included.
Left out on purpose: Apple TV (its web passcode doesn't reach your TVs),
YouTube TV (parent code is set on the TV app), Sling (PIN is set in the device
app), STARZ (its PIN can't be changed once set) and Tubi (no PIN; it asks for
the account password). A login saved for a removed service is ignored.

## Build it on your Mac

You need macOS and Node.js 20 or newer (`node -v` to check; get it from
nodejs.org if needed).

```bash
cd streamlock
npm install                 # first time only; downloads Electron (~100 MB)
npm run dev                 # runs the app now, reloads as you edit
```

To make an app you can keep in Applications:

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:mac
```

The `.dmg` is in `dist/`. Open it and drag StreamLock to Applications. It
isn't signed, so the first time, right-click the app and choose **Open**.

The app has no Dock icon. Look for the padlock-with-play icon in the menu bar.
Right-click it for Settings, Lock and Quit.

Other commands:

```bash
npm test             # unit tests (vault, PIN, schedule, controller, autofill)
npm run typecheck
npm run preview:web  # browser preview of the UI with sample data (preview/dist)
```

## Can't find StreamLock?

StreamLock lives only in the menu bar (no Dock icon). If you don't see its
padlock icon:

- **Open it again.** From Applications, Launchpad or Spotlight (type
  "StreamLock"). Opening it always shows the popover, even if it's already
  running. In development, run `npm run dev` again; closing that Terminal
  window quits the app.
- **Hidden behind the notch.** On MacBooks with a notch, menu bar icons that
  don't fit are hidden. Quit a few other menu bar apps, or use a menu bar
  manager. When the icon can't be shown, the popover opens in the top-right
  corner instead.
- **Turned off in System Settings.** Newer macOS versions let you hide apps'
  menu bar icons: System Settings → Menu Bar → *Allow in the Menu Bar*. Make
  sure StreamLock (or *Electron* when running with `npm run dev`) is on.

## How v1 applies a PIN ("assisted" mode)

None of these services has an API for changing a PIN, and their pages change
often. So v1 does not click "Save" for you. For each service, one at a time:

1. It opens that service's PIN settings page in its own window, with its own
   cookie jar (`persist:svc-<id>`).
2. While the window is open it keeps filling your saved email and password into
   sign-in forms on that service's real domains, including two-step sign-ins
   (email first, password next) and sign-in forms in embedded frames. It never
   submits the form, and never types into PIN or code boxes.
3. After you sign in, if the site drops you on its home page or profile picker,
   it goes back to the PIN page by itself. **PIN page** in the popover does the
   same at any time.
4. It copies the PIN to the clipboard and clears it after 90 seconds if it's
   still there.
5. You set the PIN on the page, then click **Done** in the popover (or
   **Skip**; closing the window also skips). The next service opens.

To redo a single service (one that failed or was skipped), click the **open** button on
its row in the popover (the box-with-arrow button).

If a service opens the wrong page, sign in to it yourself, go to the page where
the PIN is set, and paste that address into **Settings → Logins → Edit → PIN page
address**. Only that service's own domains are accepted.

On the 1st, StreamLock **notifies** you that a new PIN is ready and puts a dot
on the menu bar icon. It never opens windows on its own while you may be away.

## If you forget your master password

- **Recovery key.** Shown once right after setup (and whenever you make a new
  one in Settings → Security). Unlock screen → **Forgot password?** → **Use my
  recovery key** sets a new master password and keeps your saved logins. It is
  120 random bits, and is accepted with or without dashes, in any case.
- **Touch ID.** If Touch ID unlock is on, **Forgot password? → Use Touch ID**
  (or Settings → Security → *Forgot your current password? Use Touch ID*) sets a
  new master password after a fresh fingerprint check. Anyone who can pass
  Touch ID on your Mac could do this too.
- **Start over.** Erases the saved logins (after a second confirmation) and
  returns to setup. Settings and Last Updated dates are kept. Streaming accounts
  aren't touched. With Auto (Secret), the current PIN can't be worked out
  afterwards.

## Architecture

```
src/
  shared/      services.ts (catalog + URLs), types.ts (IPC types)
  main/
    index.ts       app lifecycle, tray, timers, Electron bindings
    controller.ts  all app logic; platform hooks injected (testable)
    vault.ts       encrypted credential store
    pin.ts         MMYY / secret / custom PIN generation
    schedule.ts    pure date logic for the monthly change
    settings.ts    non-secret prefs (validated on load)
    ipc.ts         IPC handlers: sender check + argument validation
    windows.ts     hardened popover + settings windows
    automation/    runner (assisted flow) + autofill (host-guarded)
  preload/     typed contextBridge API (the renderer never sees ipcRenderer)
  renderer/    React UI: Setup, Unlock, Popover, Settings
```

## Security model

- **Vault**: a random 256-bit data key encrypts your logins with AES-256-GCM.
  That key is wrapped with a key derived from your master password (scrypt,
  N=2^17). If Touch ID is on, it's also wrapped by the macOS Keychain via
  Electron `safeStorage`. The file is written atomically with mode 0600.
  Changing your password re-wraps the key without re-encrypting the data.
- **Touch ID caveat**: `promptTouchID` is a UI gate. The Keychain item that holds
  the wrapped key is readable by this app without a fingerprint. Malware already
  running as you could unlock the vault without Touch ID. If that matters to
  you, leave Touch ID off and use the password.
- **Renderer**: `contextIsolation`, `sandbox`, no Node, strict CSP, navigation
  and new windows blocked, all permission requests denied. Passwords never
  reach the renderer; it only sees emails.
- **IPC**: every channel rejects senders that aren't our own UI and validates
  argument types and sizes.
- **Autofill**: fills only on `https:` URLs whose exact hostname is in that
  service's `allowedHosts`, so look-alike domains and `user@host` tricks are
  refused (see `tests/autofill.test.ts`). Values are embedded as JSON and run in
  an isolated JS world.
- **Auto-lock**: after N minutes idle (default 5), on sleep and on screen lock.
  It doesn't lock in the middle of an apply run.
- **MMYY is guessable.** Anyone who learns the scheme knows every future PIN.
  *Auto (Secret)* gives a different PIN each month (HMAC of the month with a
  random key kept in the vault), and nobody can predict it.

## Before you rely on it

- [ ] **Check each service opens its PIN page.** The built-in addresses in
      `src/shared/services.ts` came from help articles. If one is wrong, set
      the right page per login in Settings → Logins (no code change needed).
- [ ] Check whether your Prime Video PIN is 5 digits. If so, turn on the
      setting in General; it adds a leading 0 (`01026`).
- [ ] Plex: only your own and managed users' PINs can be changed. Full Plex
      accounts in your Home change their own.
- [ ] HBO Max and Discovery+ lock each profile separately; Paramount+ and
      Roku use one PIN for the whole account. The Roku PIN also covers
      purchases on your Roku devices.
- [ ] Signing and notarization: `dist:mac` builds an unsigned app. Add a
      Developer ID and notarization before sharing it.
- [ ] Most services' terms restrict automated access. Assisted mode keeps you
      in the loop. Keep that in mind before automating fully.

## Tray icons

`build/icon.png` (the app icon, 1024 px; electron-builder turns it into the
macOS .icns) and `resources/tray*Template.png` (18 pt, 36 px @2x) are generated
by `npm run icons`
(`scripts/make_tray_icons.py`, needs Pillow). They're template images, so macOS
tints them for light and dark menu bars. There are three states: locked,
unlocked, and needs-you (dot).
