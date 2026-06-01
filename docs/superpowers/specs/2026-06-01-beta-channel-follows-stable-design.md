# Beta Channel Follows Stable Releases

**Date:** 2026-06-01
**Status:** Approved

## Problem

Users subscribed to the HACS beta channel currently only receive beta/RC releases. When a stable release is published, it targets the `main` branch only — the `beta` branch is left behind at the old pre-release version. Beta-channel users must manually switch to the stable channel to receive the update.

## Goal

After any stable release, beta-channel users receive the update automatically without switching channels. The `beta` channel becomes a superset: it delivers pre-releases when available, and stable releases otherwise.

## Design

### Git side — `version` job

After the stable version bump is committed and pushed to `main`, add one step that force-pushes `HEAD` to `beta`:

```yaml
- name: Sync beta branch to stable release
  if: steps.resolve.outputs.target_branch == 'main'
  run: git push origin HEAD:beta --force
```

HACS reads `config.yaml` from the tracked branch to determine the current version. After this sync, both `main` and `beta` carry the same version, so HACS will offer the stable update to beta-channel users.

### Docker side — new `build-beta-sync` job

A new job runs after `build`, only on stable releases. It checks out the now-synced `beta` branch and runs the same HA builder:

```yaml
build-beta-sync:
  name: Build & push images (beta channel sync)
  needs: [version, build]
  if: needs.version.outputs.target_branch == 'main'
  runs-on: ubuntu-latest
  steps:
    - Checkout beta branch
    - Login to GHCR
    - Run home-assistant/builder --all --addon
```

Because `beta` and `main` share the same `config.yaml` version after the sync, both jobs push `hass-odps-{arch}:{version}` with identical content. GHCR deduplicates layers, so this is effectively a manifest operation with no redundant data transferred.

### Job that needs updating: `release`

The `release` job currently `needs: [version, build]`. It does not need to wait for `build-beta-sync` — the GitHub Release targets `target_branch` (`main` for stable) and the images for that branch are already pushed by `build`. `build-beta-sync` can run concurrently with `release`.

## Channel behavior summary

| Event | `main` branch | `beta` branch | Stable users | Beta users |
|---|---|---|---|---|
| Stable release | Updated | Synced to `main` | Get update | Get update |
| Beta/RC release | Unchanged | Reset to `main` + RC version bump | No update | Get RC |

## What does not change

- The `changelog` job is still skipped for beta/RC releases.
- The GitHub Release `prerelease` flag is still `true` for RC releases and `false` for stable.
- The `build` job is unchanged; `build-beta-sync` is additive.
- The `release` job is unchanged.
