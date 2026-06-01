# Beta Channel Follows Stable Releases — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the HACS beta channel automatically receive stable releases so users never need to switch channels.

**Architecture:** Two additions to `.github/workflows/release.yml`: (1) a new step in the `version` job that force-pushes `HEAD` to `beta` after a stable version bump, and (2) a new `build-beta-sync` job that checks out `beta` and re-runs the HA builder, ensuring Docker images are pushed for the beta channel reference.

**Tech Stack:** GitHub Actions YAML; `home-assistant/builder@2024.03.5`; `docker/login-action`; `actions/checkout`.

---

## File Map

- **Modify:** `.github/workflows/release.yml`
  - `version` job (~line 147): add one step after "Commit version bump"
  - After `build` job (~line 182): add new `build-beta-sync` job

---

### Task 1: Sync `beta` branch to `main` after a stable release

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Validate the current workflow parses cleanly**

```bash
node -e "const fs=require('fs'); require('js-yaml').load(fs.readFileSync('.github/workflows/release.yml','utf8')); console.log('valid')"
```

Expected output: `valid`

- [ ] **Step 2: Add the beta-sync step inside the `version` job**

In `.github/workflows/release.yml`, locate the "Commit version bump" step (the one with `if: steps.resolve.outputs.target_branch == 'main'`). Add the following step immediately after it, at the same indentation level:

```yaml
      - name: Sync beta branch to stable release
        if: steps.resolve.outputs.target_branch == 'main'
        run: git push origin HEAD:beta --force
```

The relevant section of the `version` job should now look like this (lines ~147–160):

```yaml
      - name: Commit version bump
        if: steps.resolve.outputs.target_branch == 'main'
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add config.yaml package.json package-lock.json
          git diff --cached --quiet && echo "No change" && exit 0
          git commit -m "chore: bump version to ${{ steps.resolve.outputs.version }} [skip ci]"
          git push origin main

      - name: Sync beta branch to stable release
        if: steps.resolve.outputs.target_branch == 'main'
        run: git push origin HEAD:beta --force
```

- [ ] **Step 3: Validate the workflow still parses cleanly**

```bash
node -e "const fs=require('fs'); require('js-yaml').load(fs.readFileSync('.github/workflows/release.yml','utf8')); console.log('valid')"
```

Expected output: `valid`

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "feat: sync beta branch to main after stable release"
```

---

### Task 2: Build and push Docker images for the beta channel on stable releases

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Validate the current workflow parses cleanly**

```bash
node -e "const fs=require('fs'); require('js-yaml').load(fs.readFileSync('.github/workflows/release.yml','utf8')); console.log('valid')"
```

Expected output: `valid`

- [ ] **Step 2: Add the `build-beta-sync` job**

In `.github/workflows/release.yml`, locate the end of the `build` job (the closing of its `steps:` block). Add the following new job immediately after it, at the top-level `jobs:` indentation:

```yaml
  build-beta-sync:
    name: Build & push images (beta channel sync)
    needs: [version, build]
    if: needs.version.outputs.target_branch == 'main'
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
        with:
          ref: beta

      - name: Login to GitHub Container Registry
        uses: docker/login-action@650006c6eb7dba73a995cc03b0b2d7f5ca915bee # v4.2.0
        with:
          registry: ghcr.io
          username: ${{ github.repository_owner }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push
        uses: home-assistant/builder@2024.03.5
        with:
          args: >-
            --all
            --target /data
            --docker-hub ghcr.io/${{ github.repository_owner }}
            --addon
```

This job must appear **before** the `changelog` job in the file. The job order in the file does not affect execution order (that is controlled by `needs:`), but keeping jobs in logical order aids readability.

- [ ] **Step 3: Validate the workflow still parses cleanly**

```bash
node -e "const fs=require('fs'); require('js-yaml').load(fs.readFileSync('.github/workflows/release.yml','utf8')); console.log('valid')"
```

Expected output: `valid`

- [ ] **Step 4: Verify job dependency graph is correct**

Check the completed workflow has these `needs:` relationships:
- `version` needs `[test, docker-build, docker-smoke-test]`
- `build` needs `[version]`
- `build-beta-sync` needs `[version, build]`, only if `target_branch == 'main'`
- `changelog` needs `[version]`, only if `is_prerelease == 'false'`
- `release` needs `[version, build]`

`build-beta-sync` and `release` run concurrently after `build` completes. `changelog` also runs concurrently after `version`.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "feat: build and push Docker images for beta channel on stable release"
```
