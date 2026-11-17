---
name: preview-deploy
description: Deploy a pull request of this repo as a Coolify preview and validate it at a real URL (health, screenshots, logs) before declaring UI or deploy-affecting work done. Use after a change is ready for a real look, not on every commit.
---

# Preview deploy on Coolify

This repo deploys on the Pi through Coolify, which can build any pull request
as its own preview container with its own hostname. A preview is the most
representative check available: the real Dockerfile, the real proxy, the real
environment. Use it as the last step before you report UI or deploy-affecting
work as done. Iterate locally until then (dev server plus
`playwright screenshot`), because every preview deploy is a full image build
on the Pi.

## What this skill expects

- `COOLIFY_API_TOKEN` in the environment. On this server it belongs in
  `~/.zshrc`; ask the user if it is missing and never commit it.
  `COOLIFY_API_URL` defaults to `http://localhost:8000`, Coolify on this host.
- `preview.env` next to this file names the Coolify application and what to
  check. `gh`, `curl`, `jq` and `playwright` are on this server.

## Steps

1. Push the branch and open a pull request with `gh pr create`, or get the
   number of the existing one with `gh pr view --json number -q .number`.
2. Build the preview:
   `sh .claude/skills/preview-deploy/preview.sh open <pr>`.
   It creates the preview or redeploys it, waits for the build and prints the
   URL. On failure it prints the deployment log tail; fix the build before
   anything else.
3. Validate at the URL it printed.
   `sh .claude/skills/preview-deploy/preview.sh check <pr>` curls the health
   path and screenshots `ROUTES` from `preview.env` into `shots/`. Add
   `playwright screenshot --full-page "$URL<route>" shots/<name>.png` for
   every other route the change touches, then look at each PNG. Compare
   against what you intended, not just whether it rendered.
   - `sh .claude/skills/preview-deploy/preview.sh logs <pr>` if anything is
     off.
4. Report on the PR with `gh pr comment <pr>`: the preview URL, what you
   checked and anything that needs a human look. The URL stays up until the
   preview is closed, so the user can open it from any device.
5. When the PR is merged or abandoned,
   `sh .claude/skills/preview-deploy/preview.sh close <pr>` removes the
   container and hostname. Do not leave previews running.

## Rules

- Run `open` again only when a batch of changes is worth a look.
- A preview shares the Pi with production services. Never change the Coolify
  application itself; the script touches previews only.
- Never put the token in a file in the repo or in a PR comment.

## Adapting this skill to another repo

Copy `/usr/local/share/rex/skills/preview-deploy` into the repo's
`.claude/skills/`, then edit `preview.env`: the Coolify application UUID (the
id in Coolify's URL for the app, or ask the user), the health path and the
routes worth screenshotting. The application needs Preview Deployments
enabled in Coolify with a URL template that yields a first-level hostname
under a wildcard-covered domain, such as `name-pr-{{pr_id}}.korzun.com`;
second-level names like `{{pr_id}}.app.korzun.com` get no TLS at Cloudflare.
