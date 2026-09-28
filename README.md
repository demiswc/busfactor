# busfactor

**A dead man's switch for solo developers, and anyone who holds the keys.**

When you run everything yourself (the servers, domains, DNS, client sites, the Stripe account, the repos, the hardware keys), your *bus factor* is one. If you went quiet tomorrow, nobody would know where anything is.

It was built for developers, but it works for anyone who is the only one who knows how to find, open or keep something running: a small business, a freelance practice, years of creative or research work, a family's finances, a crypto wallet or a safe. Templates are included for each.

busfactor fixes that, gently:

1. **You check in** every few weeks: press *I'm OK* on the dashboard, tap the button in the reminder email, or run `busfactor checkin` in your terminal. Miss it and you get two reminders by email, plus ntfy, Discord, Slack, Telegram or a webhook if you add them.
2. **Your people are asked.** Still nothing? The people you chose get an email: *"Is Alex OK?"* with two buttons.
3. **It waits, carefully.** Silent contacts get a reminder. Two *not OK* answers, or one plus silence, or no answer at all, start a safety wait you can cancel with one click.
4. **The right person takes over.** Your trusted person gets a private link to your handover instructions and a personal message, with files if you like, that **only they can open, with a passphrase only they know**.

Free and open source (MIT). Hosted at **[busfactor.co.uk](https://busfactor.co.uk)**, or run your own copy with one command.

---

## Features

| | |
|---|---|
| **Human confirmation** | Two contacts confirm before anything is released (configurable), with reminders, "trust the first answer" and "no answer" rules, and a cancellable safety wait. Any contact saying *they're OK*, or you checking in, cancels everything instantly. |
| **Recipient-held keys** | When your trusted person accepts, their browser makes a key pair locked with *their own* passphrase. Messages you leave them are encrypted to that key in your browser: not even the server can read them, and you never have to hand over a passphrase in advance. Key fingerprints let you both check the key by phone. |
| **Personal messages + files** | A separate message for each trusted person, with attachments up to 10 MB (credentials, a PDF of your handover document…). |
| **Sealed instructions** | General instructions locked with a passphrase (Argon2id → AES-256-GCM) in your browser. Templates for developers, small businesses, creative work, household affairs and anything else. |
| **Links, not secrets** | Nothing sensitive is ever emailed. The handover is a private link that dies the moment you check in. |
| **Consent first** | Contacts accept an invitation before they ever count, so nobody gets a frightening email out of the blue. |
| **Two-factor login** | Passkeys and security keys (YubiKey, Face ID, Windows Hello), authenticator apps, email codes, recovery codes. |
| **Extra alert channels** | ntfy, Discord, Slack, Telegram or any HMAC-signed webhook, for reminders that must not be missed and for automation (e.g. switch a site to maintenance mode when the handover is sent). |
| **Phone reminders, no app** | Reminders arrive as a notification on your phone instead of an email: tap it, confirm with Face ID or your fingerprint (passkey), done. Works in the browser on Android, and on iPhone (iOS 16.4+) once busfactor is added to the home screen. The second reminder always goes by email too, and a phone that stops receiving is removed and reported, so a silent failure cannot hide a missed check-in. |
| **Check in anywhere** | Phone notification, dashboard, one-click button in reminder emails, `curl`/CLI with a personal token. Only a deliberate action counts: logging in or adding a device never resets the timer. |
| **Pause** | Holiday or hospital stay: pause for up to 90 days. |
| **Private by design** | Names, emails and contact details are encrypted at rest; a stolen database dump shows only scrambled data. |

## How the escalation works

```
check-in ──► 14 days ──► reminder 1 ──► 19 days ──► reminder 2 ──► 20 days ──► ask contacts
                                                                                    │
     ┌──────────── any contact says "OK", or you check in: everything resets ◄──────┤
     │                                                                              ▼
     │   2 × "not OK" ─────────────────────────────────────────────────────► safety wait (48h)
     │   silent after 72h ──► reminder to silent contacts ──► 24h ──► answers so far │
     │                                                        trusted / silence      ▼
     └──────────────────────────────────────────────────────────────────── handover link
```

Every number is adjustable. Once the handover link has been sent, only you can cancel it (by checking in).

## Security model

busfactor is open source: anyone can read exactly how it works. Its security does not depend on the code being secret. It depends on secrets that never leave the server, and on a design where a break-in yields as little as possible.

| | |
|---|---|
| **Browser-side encryption** | Sealed instructions: Argon2id (64 MiB, 3 passes) → AES-256-GCM. Personal messages: ephemeral ECDH P-256 → HKDF-SHA256 → AES-256-GCM to the recipient's public key; their private key is sealed with their own Argon2id passphrase. |
| **Encryption at rest** | Names, emails, event details, alert URLs and TOTP secrets: AES-256-GCM with HKDF-derived subkeys of `APP_ENCRYPTION_KEY`. Accounts are looked up by HMAC fingerprint, not by email. |
| **Tokens** | 256-bit random, stored only as SHA-256 hashes, single-use, scoped to one alert cycle, 30-day expiry, revoked on check-in. |
| **Scanner-safe** | Every emailed link (verify, accept, answer, check in, open the handover) needs a button press, so link-preview bots cannot trigger anything. |
| **Exactly-once** | Every stage change is a guarded `UPDATE … WHERE stage = expected`; overlapping scheduler runs cannot send anything twice. |
| **Login** | bcrypt (cost 12); hashed session tokens in httpOnly, SameSite cookies; 2FA attempts claimed atomically (no parallel brute force); TOTP codes single-use; only failed logins count towards limits, and an account under attack still lets the right password in with an emailed code; the owner is warned when someone passes the password but fails the second step. |
| **Sensitive changes** | Turning the switch off, pausing, changing contacts, instructions, messages or channels needs the password re-entered within 15 minutes, and the owner is emailed about every such change. |
| **Web hardening** | Nonce-based CSP (no inline scripts), `Referrer-Policy: no-referrer`, HSTS, frame denial, same-origin checks on every POST, streaming request-size limits, DB-backed rate limits, no account enumeration. |
| **Phone notifications** | Web Push with a server key pair created on first run (private half encrypted in the database). Subscriptions are encrypted at rest and only accepted for the real push services (Google, Apple, Mozilla, Microsoft), so the server can never be pointed at another address. Payloads are end-to-end encrypted to the device. Adding a device needs the password and emails the owner. |
| **SSRF guard** | User-supplied alert URLs: HTTPS only, DNS resolved and pinned, every private, reserved and IPv4-in-IPv6 range refused (via ipaddr.js), no redirects, hard 10-second deadline. |

It has had an independent adversarial review. See [docs/HOSTING.md](docs/HOSTING.md) for what a break-in would and would not reveal, and the checklist for running it as a public service.

**Limits, stated honestly:** email can be delayed or land in spam (turn on phone reminders or add an alert channel); phone notifications can silently stop after a phone is replaced or reset (the second reminder therefore always goes by email as well); a server can be down (the scheduler catches up, with a minimum 12-hour gap between reminder stages, and `/api/health` plus `HEALTHCHECK_PING_URL` tell you when it stops). busfactor is not a will or a legal document: keep a written plan with the people you trust too.

---

## Self-hosting

You need a server, a domain pointing at it, and an SMTP mailbox for outgoing email.

### Option 1: Docker (any Linux)

```bash
git clone https://github.com/demiswc/busfactor.git
cd busfactor
sudo bash install.sh --docker
```

It asks for your domain and SMTP details, writes `.env` with fresh secrets, and starts MariaDB, the app, the scheduler and (optionally) Caddy with automatic HTTPS. Update later with `sudo bash install.sh --docker --update`.

Prefer to do it by hand? Copy `.env.example` to `.env`, fill it in (plus `DB_PASSWORD` and `DOMAIN`), then `docker compose --profile https up -d --build` (drop `--profile https` if you already run a web server; the app listens on `127.0.0.1:3000`).

### Option 2: Straight onto Ubuntu 22.04+ / Debian 12+

```bash
git clone https://github.com/demiswc/busfactor.git
cd busfactor
sudo bash install.sh
```

The script installs Node.js 22 (if needed) and MariaDB (unless you give your own `DATABASE_URL`), creates a `busfactor` system user, a database and `/opt/busfactor/.env` with fresh secrets, builds the app, and starts two systemd units: `busfactor` (web app on `127.0.0.1:3000`) and `busfactor-tick.timer` (scheduler, every 5 minutes). It can install **Caddy** for automatic HTTPS; otherwise it prints an nginx snippet.

Unattended: `sudo DOMAIN=busfactor.example.com USE_CADDY=y SMTP_HOST=… SMTP_USER=… SMTP_PASS='…' bash install.sh --yes`
Update: `cd /opt/busfactor && sudo git pull && sudo bash install.sh --update`

### Behind an existing web server (nginx, Apache, Plesk, cPanel)

Answer **n** to Caddy, then proxy your domain to `127.0.0.1:3000`:

```nginx
client_max_body_size 32m;
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto https;
}
```

**Plesk:** create the domain and a MariaDB database in Plesk, then run the installer with `DATABASE_URL=mysql://user:pass@127.0.0.1:3306/dbname` so it doesn't install its own MariaDB. Put the block above in *Apache & nginx Settings → Additional nginx directives*, issue a Let's Encrypt certificate in Plesk, and set `max_allowed_packet=64M` for MariaDB.

### Manual install (any OS with Node 20.9+ and MariaDB/MySQL 8)

```bash
npm ci                         # also runs `prisma generate`
cp .env.example .env           # fill it in
npx prisma db push             # create the tables
npm run build
npm start
```

Then call the scheduler every 5 minutes, e.g. from cron: `curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" http://127.0.0.1:3000/api/cron/tick`

**Back up `.env`.** Without `APP_ENCRYPTION_KEY` the database cannot be read. Back up the database too (`mysqldump busfactor`), encrypted.

### Configuration

| Variable | Required | Description |
|---|---|---|
| `APP_URL` | yes | Public address, e.g. `https://busfactor.example.com`. Used in every email link and as the passkey domain. |
| `DATABASE_URL` | yes | `mysql://user:pass@host:3306/db` |
| `APP_ENCRYPTION_KEY` | yes | `openssl rand -base64 32`. Encrypts personal details at rest. **Back it up.** |
| `CRON_SECRET` | yes | `openssl rand -hex 24`. The scheduler endpoint answers 404 without it. |
| `SMTP_HOST`, `SMTP_PORT` | yes | Port 465 = TLS, 587 = STARTTLS. |
| `SMTP_USER`, `SMTP_PASS` | usually | Or `SMTP_PASS_B64` (base64) if the password contains `$ # " '` or spaces. The installers do this for you. |
| `SMTP_FROM` | yes | e.g. `"busfactor <no-reply@example.com>"` |
| `ALLOW_SERVER_INSTRUCTIONS` | no | `false` on public services, so the operator never holds readable instructions. Default `true`. |
| `TRUST_PROXY_HOPS` | no | Reverse proxies in front of the app: 1 (default) for Caddy/nginx, 2 with a CDN in front. |
| `HEALTHCHECK_PING_URL` | no | Pinged after each scheduler run (healthchecks.io, Uptime Kuma). |
| `SMTP_TLS_SERVERNAME` | no | Certificate name to check when `SMTP_HOST` is an IP address. |
| `DEFAULT_TIMEZONE` | no | For dates in emails. Default `Europe/London`. |
| `OPERATOR_NAME`, `OPERATOR_EMAIL` | no | Shown on the privacy page. |
| `DB_PASSWORD`, `DOMAIN` | Docker only | Database password and domain for Caddy. |

### The CLI

```bash
curl -fsSL https://raw.githubusercontent.com/demiswc/busfactor/main/bin/busfactor -o ~/.local/bin/busfactor && chmod +x ~/.local/bin/busfactor
busfactor setup      # paste a token from Settings → "Check in from the terminal"
busfactor checkin
```

It refuses to run without a terminal: a check-in from cron would keep going after you are gone.

---

## Development

```bash
npm install
cp .env.example .env    # without SMTP_HOST, emails are printed to the console in dev
npx prisma db push
npm run dev
```

Tests run against a real, throwaway MariaDB database (tables are built from `prisma/schema.prisma` automatically):

```bash
TEST_DATABASE_URL=mysql://user:pass@127.0.0.1:3306/busfactor_test npm test
```

- `tests/stages.test.ts`: the escalation rules as pure functions
- `tests/flow.test.ts`: every scenario through the database with a fake mailbox, including privacy (no readable personal data in the database), webhook signing and SSRF refusals
- `tests/sealed.test.ts`: browser encryption and recipient keys
- `tests/totp.test.ts`: RFC 6238 vectors and private-address detection

### Layout

```
lib/engine/stages.ts   the escalation rules (pure, no I/O)
lib/engine/service.ts  database + email side effects, the scheduler tick
lib/sealed.ts          browser-side encryption (passphrase boxes, recipient keys, fingerprints)
lib/crypto.ts          server-side encryption at rest, token hashing
lib/twofactor.ts       passkeys, TOTP, email codes, recovery codes
lib/channels.ts        ntfy / Discord / Slack / Telegram / webhooks with the SSRF guard
lib/emails.ts          every email, in plain English
app/                   Next.js pages and API routes;  proxy.ts sets the nonce CSP
install.sh             self-host installer (systemd or --docker)
docker-compose.yml     MariaDB + app + scheduler (+ Caddy)
bin/busfactor          command-line check-in
```

Stack: Next.js 16, React 19, Prisma 7 (pure-TypeScript client with the MariaDB driver adapter), Tailwind 4, nodemailer, @simplewebauthn, hash-wasm.

## Contributing

Issues and pull requests are welcome. Please keep the tone of the emails plain, calm and kind: the people reading them may be having the worst day of their lives.

Security issues: see [SECURITY.md](SECURITY.md). Please don't open public issues for vulnerabilities.

## License

MIT © Demis Cunningham. A gift, for everyone who is the only one with the keys.
