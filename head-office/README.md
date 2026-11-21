# Sultan's Head Office — online copy

Read-only copy of the Head Office board (the live, interactive board stays in Claude).

- **Link:** `https://abc-head-office.sultanachi-lb-61f.workers.dev/?key=<HO_KEY>` — the key is remembered for 30 days on that device.
- **Data:** `public/data.enc` is the board's `data.json`, gzipped then AES-256-GCM encrypted with SHA-256(HO_KEY), because this repo is public. Never commit the plain `data.json`.
- **Sync on/off:** edit `sync.json` — `{"enabled": true}` lets the hourly Claude refresh commit a new `public/data.enc`; `{"enabled": false}` stops it (the online copy then stays as it is).
- **Deploy:** `.github/workflows/head-office.yml` deploys only when `head-office/**` changes. The Operations Hub deploy ignores this folder.
- **Setup once:** add the GitHub Actions secret `HO_KEY` (Settings → Secrets and variables → Actions). The workflow copies it into the worker.
