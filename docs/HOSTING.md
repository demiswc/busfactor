# Running busfactor as a public service

This is the checklist for busfactor.co.uk, and for anyone offering busfactor to other people.
The code is public, so security must never depend on it being secret: it depends on the secrets below
staying on the server, and on the design making a break-in yield as little as possible.

## Configuration

- [ ] `ALLOW_SERVER_INSTRUCTIONS=false`: users can then only store instructions sealed in their browser
      (passphrase or recipient key). The operator never holds anything readable.
- [ ] `APP_URL=https://your-domain` (HTTPS only; the CSP adds `upgrade-insecure-requests`).
- [ ] `TRUST_PROXY_HOPS` matches your proxy chain (1 for Caddy/nginx; 2 if a CDN such as Cloudflare sits in front).
- [ ] `HEALTHCHECK_PING_URL` set to a healthchecks.io / Uptime Kuma push monitor, so a dead scheduler pages you.
- [ ] Monitor `https://your-domain/api/health` (returns 503 if the database or scheduler is unhealthy).
- [ ] `ALLOW_PRIVATE_WEBHOOKS` unset.
- [ ] SMTP with SPF, DKIM and DMARC set up for the sending domain, or reminders will land in spam.
- [ ] `OPERATOR_ADMIN_EMAILS` set to a dedicated account (e.g. `security@your-domain`) with a passkey or authenticator app,
      so you can see usage at `/stats` and get the Monday summary. Watch for: *Emails failed* above zero, the scheduler
      *Not running*, switches sitting in *Safety wait* or *Handover sent*, and page load (LCP p75) over 2.5 s.

## Secrets

- [ ] `.env` is mode 600 and owned by the app user (the installer does this).
- [ ] `APP_ENCRYPTION_KEY` backed up offline (password manager + paper in a safe). Without it, the database is unreadable,
      which is the point, but also means you cannot recover it.
- [ ] Database backups are encrypted (e.g. `mysqldump | age -r <key> > backup.sql.age`) and stored off the server.
      Backups never contain the encryption key.
- [ ] Nothing from `.env` is ever pasted into chat, tickets or git.

## Server

- [ ] Firewall: only 22 (SSH, key/YubiKey only), 80 and 443 open. MariaDB listens on 127.0.0.1 only.
- [ ] The database user `busfactor` has rights on the `busfactor` database only (the installer does this).
- [ ] Automatic security updates on (`unattended-upgrades`).
- [ ] Intrusion detection / log monitoring (e.g. Wazuh agent) watching the app host.
- [ ] `npm audit` clean before every update; never `npm audit fix --force` without testing.
- [ ] Web server body limit 32 MB (`client_max_body_size 32m;` in nginx; the installer's Caddyfile sets it).

## What a break-in would reveal

| An attacker gets… | They see |
|---|---|
| A database dump or backup only | Scrambled data. Names, emails, contacts, channel URLs and events are encrypted; sealed instructions and personal messages need passphrases the server never had. |
| The server with its `.env` | Names and email addresses of users and contacts, and who is at which stage. **Still not** sealed instructions or personal messages already stored. But someone in full control of the server could change the site's code to capture passphrases typed *afterwards*, which is why the server itself must be protected like the crown jewels, and why key fingerprints let owners and trusted people check that a key has not been swapped. |
| A user's logged-in browser | Their dashboard. Weakening changes need the password re-entered, and the owner is emailed about each one. |
| The operator's stats account | Counts and timings: how many users, emails, check-ins, and how fast pages load. **No** names, emails, user ids or IP addresses are stored for statistics, so there is nobody to identify. |
| A user's password | Blocked by their second factor, if they set one up; the owner is emailed after repeated second-step failures. |
