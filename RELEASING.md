# Releasing (Tauri Updater + GitHub Releases)

This repo uses the official Tauri v2 updater plugin and publishes update artifacts to GitHub Releases.

## 1) Generate updater signing keys

Run in `todo-tool/`:

```powershell
.\node_modules\.bin\tauri signer generate -w "$env:USERPROFILE\.tauri\fk.todo.key"
```

- Keep the generated private key file secret.
- Copy the printed public key string into `todo-tool/src-tauri/tauri.conf.json` under `plugins.updater.pubkey`.

## 2) Configure GitHub Actions secrets

In your GitHub repo settings: `Settings -> Secrets and variables -> Actions`

- `TAURI_SIGNING_PRIVATE_KEY`: either the private key *content* or a *path* (content is recommended for CI)
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: optional (only if you generated the private key with a password)

## 3) Bump versions (must stay in sync)

Update the version in:

- `todo-tool/package.json`
- `todo-tool/src-tauri/Cargo.toml`
- `todo-tool/src-tauri/tauri.conf.json`

## 4) Create a tag and push

```bash
git tag V<version>
git push origin V<version>
```

This triggers `.github/workflows/release.yml` (only `V*` tags), which builds installers for Windows/macOS/Linux, uploads them to the Release, and also uploads `latest.json`.

Note: the tag must point to a commit that is on the release branch (`master`, or `main` if `master` doesn't exist).

## 5) Runtime updater endpoint

The app is configured to check:

`https://github.com/Tioit-Wang/fk.todo/releases/latest/download/latest.json`

