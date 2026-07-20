# Auto-update

Bridge checks GitHub releases once per launch, downloads in the background, and
applies the update when you next quit. A running agent session is never
interrupted.

Owner: `src/main/updater.ts`. Feed + token: `src/main/updateToken.ts`.

## One-time setup (required — updates are OFF until this is done)

`Tolui-studios/Bridge` is private, so release assets need a credential. Mint a
**fine-grained** PAT and paste it into `src/main/updateToken.ts`:

1. GitHub → Settings → Developer settings → Personal access tokens →
   **Fine-grained tokens** → Generate new token.
2. **Resource owner:** `Tolui-studios`.
3. **Repository access:** *Only select repositories* → **Bridge**. Never
   "All repositories".
4. **Permissions:** Repository permissions → **Contents: Read-only**. Nothing
   else.
5. Set the longest expiry you're willing to rotate, then paste into
   `UPDATE_TOKEN` and ship a build.

> ⚠️ **This token ships inside the installer and is extractable** — `app.asar`
> is a container, not encryption. Treat it as public. That is why it must be
> read-only and scoped to this one repo: the worst case for a leak is that
> someone reads Bridge's source. A classic PAT with `repo` scope would instead
> grant read **and write** to every private repo in the org — never use one.

**When it expires, updates stop silently** for every installed copy (the
updater logs a 401 and gives up). Set a calendar reminder to rotate.

To disable auto-update, leave `UPDATE_TOKEN` empty — the updater no-ops and
reports why.

## Cutting a release

Updates are decided by **semver comparison against `package.json`**, so every
release needs a real, increasing version. A fixed tag like `prerelease` will
never trigger an update.

```sh
npm version patch      # or minor / major — bumps package.json and tags
$env:GH_TOKEN = "<a token with write access>"   # NOT the shipped read-only one
npm run release
```

`npm run release` builds and uploads both artifacts. Both are mandatory:

| Artifact | Why |
|---|---|
| `bridge-<version>-setup.exe` | The installer itself |
| `latest.yml` | The manifest electron-updater reads — **without it no client sees the update** |

A hand-uploaded `.exe` with no `latest.yml` is invisible to the updater. This
is why the existing `prerelease` tag never updated anything.

`GH_TOKEN` for publishing is a *separate*, write-capable token that lives only
in your shell — never in the repo.

## Behavior

| State | What you see |
|---|---|
| `disabled` | Dev build, or no token compiled in |
| `checking` / `current` | Nothing — silent |
| `downloading` | Nothing — silent, in the background |
| `ready` | A green strip: "Bridge X.Y.Z downloaded — installs when you close the app" |
| `error` | Nothing in the UI; reason is on the state via `getUpdateState()` |

Failure is always soft: no network, expired token, or a release missing
`latest.yml` leaves Bridge running normally.

## macOS

Not yet wired. macOS auto-update **requires the app to be code-signed and
notarized** — electron-updater refuses to apply an unsigned update. The
`publish` block and `UpdaterService` are cross-platform already; the missing
pieces are a Developer ID certificate, notarization in the build, and a `mac`
target in `electron-builder.yml`.

## If you later make releases public

Create a public `Bridge-releases` repo, point `publish` and `UPDATE_REPO` at
it, drop `private: true`, and delete `updateToken.ts` and its import. No token
needs to ship at all — that is the strictly safer setup if the tradeoff above
stops feeling worth it.
