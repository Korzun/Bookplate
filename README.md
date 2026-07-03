# Bookplate

[![GitHub Release][release-shield]][releases]
[![Project Stage][stage-shield]][releases]
[![License][license-shield]](#license)

![Supports aarch64][aarch64-shield]
![Supports amd64][amd64-shield]
![Supports armhf][armhf-shield]
![Supports armv7][armv7-shield]

A Home Assistant add-on that turns your library of EPUBs into a self-hosted book
server for [KOReader][koreader]: an **OPDS 1.2** catalog for browsing and
downloading, **KOSync** for reading-progress sync across devices, and a **web
library manager** for uploading books and editing metadata.

## Features

- **📚 OPDS 1.2 catalog** — browse and download your library from any OPDS-capable
  reader, organised by series, authors, and subjects, with cover thumbnails.
- **🔄 KOSync progress sync** — keep your reading position in sync across all your
  KOReader devices.
- **🖥️ Web library manager** — upload EPUBs, edit metadata, manage covers, and
  organise series from any browser.
- **👥 Per-user libraries** — each user gets their own library and their own
  reading progress, with an admin panel for user management.
- **🏗️ Multi-arch** — runs on `aarch64`, `amd64`, `armhf`, and `armv7`.

## Installation

1. Navigate to **Settings → Add-ons → Add-on Store** in your Home Assistant UI.
2. Click the ⋮ menu (top-right) → **Repositories**, and add this repository URL:

   ```
   https://github.com/Korzun/Bookplate
   ```

   [![Add repository to your Home Assistant instance][repo-badge]][repo-add]

3. Find **Bookplate** in the store and click **Install**.
4. Set your admin `username` and `password` in the **Configuration** tab (see
   below), then **Start** the add-on.
5. Open the Web UI to log in and create your reader users.

## Configuration

Add-on options (set in the **Configuration** tab):

| Option                   | Type   | Default     | Description                                                        |
| ------------------------ | ------ | ----------- | ------------------------------------------------------------------ |
| `library_name`           | string | `Bookplate` | Title shown in the OPDS catalog and web UI.                        |
| `library_dir`            | string | `books`     | Sub-directory under `/media` where libraries are stored.           |
| `username`               | string | `admin`     | Admin account username.                                            |
| `password`               | string | `changeme`  | Admin account password. **Change this before starting.**          |
| `max_concurrent_uploads` | int    | `3`         | Maximum number of simultaneous uploads processed by the server.   |

Example:

```yaml
library_name: My Library
library_dir: books
username: admin
password: a-strong-password
max_concurrent_uploads: 3
```

Books are stored under the Home Assistant **`media`** share (`/media/<library_dir>`),
one folder per user. Add-on state (the SQLite database and generated cover
thumbnails) is persisted in the add-on **`data`** volume.

## Usage

The add-on serves three things on port **3000**, all on the same host/origin:

| Service     | Path      | Use it for                                            |
| ----------- | --------- | ----------------------------------------------------- |
| **Web UI**  | `/`       | Uploading books, editing metadata, managing users.    |
| **OPDS**    | `/opds`   | Browsing/downloading the catalog from a reader.        |
| **KOSync**  | `/kosync` | Syncing reading progress from KOReader.                |

The exact URLs for your instance (LAN address, reverse proxy, or Cloudflare
tunnel) are shown on each user's **settings page** in the web UI — just copy them
into your reader.

### Two separate credentials

Each account has **two different passwords**, and they are not interchangeable:

| Credential        | Used for                     | Where to find / set it                                  |
| ----------------- | ---------------------------- | ------------------------------------------------------- |
| **Login password**| The **Web UI** (browser)     | Set at login/first sign-in; changed on the settings page. |
| **Sync password** | **OPDS** and **KOSync** (readers) | Shown on your settings page in the web UI.               |

Your reader devices (OPDS, KOSync) authenticate with the **sync password** — the
web UI login password will **not** work there. Likewise, signing in to the web UI
uses your **login password**, not the sync password.

### Connect to the Web UI

Open the add-on in a browser and sign in with your account **username** and
**login password**:

- **URL:** `http://<your-host>:3000/`
- **Username / Password:** your account username and **login password** (the one
  you use to sign in — *not* the sync password).

The **admin** account (the `username` / `password` set in the add-on
configuration) signs in the same way and can create reader users, reset
passwords, and manage the library from the admin panel. Once signed in, open your
**settings page** to view your sync password and the OPDS / KOSync URLs for your
reader devices.

### Connect to OPDS catalog

In KOReader: **File browser → top menu → search icon (🔍) → OPDS catalog → `+`**,
then add:

- **Catalog URL:** `http://<your-host>:3000/opds`
- **Username / Password:** your reader account username and **sync password**
  (found on your settings page in the web UI).

### Connect to progress sync (KOSync)

In KOReader: **top menu → tools (🔧) → Progress sync → Custom sync server**:

- **Server address:** `http://<your-host>:3000/kosync`
- Then **Login** with your reader account username and **sync password** (found
  on your settings page in the web UI).

## Ports

| Port       | Description                                  |
| ---------- | -------------------------------------------- |
| `3000/tcp` | Book server — OPDS, KOSync, and Web UI.      |

## Development

The repository is an npm workspace monorepo (`app/server` — Express + Prisma/SQLite;
`app/client` — React + Vite). A `Makefile` and `docker-compose.yml` wrap the common
tasks.

```bash
# Live-reload dev stack: backend on :3000, frontend on :5173
make dev            # BOOKS=/path/to/books make dev  to point at your library

# Production-style single container
make run            # build + run at http://localhost:3000
make logs           # tail container logs
make stop           # stop and remove the container

# Native (without Docker)
npm ci
npm run dev         # server, live-reload
npm run dev:client  # client, live-reload
npm run build       # build server + client
npm test            # run server + client tests
npm run lint        # lint server + client
```

### Environment variables (dev / bare-metal)

When not running under Home Assistant, configuration falls back to environment
variables:

| Variable        | Default        | Description                                  |
| --------------- | -------------- | -------------------------------------------- |
| `ADMIN_USER`    | `admin`        | Admin username.                              |
| `ADMIN_PASS`    | `changeme`     | Admin password.                              |
| `LIBRARY_NAME`  | `Bookplate`    | Catalog / UI title.                          |
| `BOOKS_DIR`     | `/media/books` | Absolute path to the library root.           |
| `DATA_DIR`      | `/data`        | Path for the SQLite DB and thumbnails.       |
| `PORT`          | `3000`         | HTTP listen port.                            |
| `LOG_LEVEL`     | `info`         | Log verbosity.                               |

## Release channels

- **Stable** — the default. Released from `main`; regular Home Assistant users
  are updated here.
- **Beta** — opt-in pre-release channel. Add the repository, then enable the beta
  version in the add-on's **Version** section to test release candidates early.

See [`CHANGELOG.md`](CHANGELOG.md) for release notes.

## License

No license has been declared for this project yet. All rights reserved by the
author until a license is added.

[koreader]: https://koreader.rocks/
[releases]: https://github.com/Korzun/Bookplate/releases
[release-shield]: https://img.shields.io/github/v/release/Korzun/Bookplate?style=flat-square
[stage-shield]: https://img.shields.io/badge/project%20stage-production-brightgreen.svg?style=flat-square
[license-shield]: https://img.shields.io/badge/license-all%20rights%20reserved-red.svg?style=flat-square
[aarch64-shield]: https://img.shields.io/badge/aarch64-yes-green.svg?style=flat-square
[amd64-shield]: https://img.shields.io/badge/amd64-yes-green.svg?style=flat-square
[armhf-shield]: https://img.shields.io/badge/armhf-yes-green.svg?style=flat-square
[armv7-shield]: https://img.shields.io/badge/armv7-yes-green.svg?style=flat-square
[repo-add]: https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2FKorzun%2FBookplate
[repo-badge]: https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg
