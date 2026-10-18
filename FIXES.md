# Bug Audit & Fixes (2026-10-17)

Baseline: 285 tests passing, tsc and lint clean, but ~50 real bugs. After the fixes: 454 tests pass (the live-controller integration test is opt-in), coverage is 99.55% lines, and tsc and lint are clean (only the 3 original warnings remain).

## Security

| # | Bug | Fix |
|---|-----|-----|
| 1 | Hardcoded JWT fallback secret let anyone forge an ADMIN token | `JWT_SECRET` is now required in production (≥32 chars) (`lib/auth/session.ts`) |
| 2 | In-memory DB fallback could switch on in production (from a pool timeout or Postgres restart) and stay on. Real users were then locked out and the public default admin password worked | Fallback is dev-only unless `ALLOW_MEMORY_FALLBACK=true`; DB errors are rethrown in production (`lib/db/pool.ts`, `queries.ts`, `schema.ts`) |
| 3 | Any logged-in USER could pull every client's MAC/IP and every operator's email and login stats from `/api/reports/summary` | Non-admins only see scoped clients; operator and security sections are removed (`lib/reports/aggregation.ts`) |
| 4 | Admin routes trusted the role stored in the JWT, so a demoted or deleted admin kept access | `requireAdmin()` checks the role in the DB (`lib/auth/guards.ts`) |
| 5 | An admin could demote or delete themselves, or remove the last admin (lockout) | Guards in `app/api/admin/users/[id]/route.ts` |
| 6 | Device scoping failed open: a USER saw everything if the tag lookup errored | Fails closed; one shared helper in `lib/auth/device-scope.ts` |
| 7 | Scoped users still saw site-wide VLAN/SSID counts, WAN totals, and other clients' events | Counts are computed after scoping; events and WAN totals are dropped for scoped users |
| 8 | bcrypt hashes were returned in admin API JSON (in-memory mode) | Stripped (`lib/db/memory.ts`) |
| 9 | `NODE_TLS_REJECT_UNAUTHORIZED=0` was set process-wide by default | Only set when `OMADA_ALLOW_INSECURE_SSL=true` |
| 10 | Login timing revealed which usernames exist; a long X-Forwarded-For header kept failed logins out of the audit log | Dummy bcrypt compare; IP trimmed to the first hop and 45 chars |
| 11a | **Controller lockout:** with no credentials set, the client fell back to `admin`/`password`, and the integration tests ran the real MCP server against `192.168.100.2` on every `npm test`. Each run sent failed logins, which tripped the controller's brute-force lockout | No default credentials; a 5-min backoff after a rejected login; integration tests only run via `npm run test:integration` |
| 11 | Next.js 16.3.3 had critical advisories (RCE, SSRF, cache poisoning) | Upgraded to 16.3.8; production deps report 0 vulnerabilities |

## Broken functionality

| # | Bug | Fix |
|---|-----|-----|
| 12 | Session never renewed: active users were logged out 15 min after login | Proxy re-signs the token on each request (`proxy.ts`) |
| 13 | `secure` cookie on plain HTTP: login over `http://<LAN-IP>:3000` silently bounced back to the login page | Secure flag is detected from the request; `COOKIE_SECURE` overrides it |
| 14 | Redirect loop (ERR_TOO_MANY_REDIRECTS) after a user was deleted | `GET /api/auth/logout` clears the cookie and redirects |
| 15 | MAC tags never matched: Omada uses `AA-BB-…` while users type `AA:BB:…`, so tagged users saw 0 clients | `normalizeMac()` is used everywhere; tags are stored in canonical form |
| 16 | Status badges were always green: offline APs, switches, WAN, and the controller all showed "Online" | Badges are derived from real status (`isDeviceOnline()`) |
| 17 | Topology tab crashed the whole dashboard when a node had no type | Guarded |
| 18 | Only page 1 of clients and devices was fetched | Pages are fetched until `totalRows` is reached |
| 19 | No fetch timeouts: an unreachable controller took about 150 s per call | 8 s timeout (`OMADA_TIMEOUT_MS`); no fallbacks are tried on network errors |
| 20 | Parallel calls each started their own re-login after the session expired | Re-login is single-flight; `-12xx` "login required" codes are handled |
| 21 | Controller offline gave health score 100 and "IMPROVED", which poisoned the AI baseline | Audit is refused and nothing is saved while the controller is offline |
| 22 | DeepSeek output was cut off inside `<think>`, then a made-up score of 92 was saved | `<think>` is stripped, JSON is parsed with brace balancing, and nothing is saved on a parse failure |
| 23 | AI drawer showed the oldest audit as "latest" | History is merged and sorted by date |
| 24 | Seeding race created duplicate admins and then forced the app permanently into memory mode | Memoized `initDb` + `ON CONFLICT DO NOTHING` |
| 25 | A partial profile update blanked fields; a profile change with a wrong password was still saved | COALESCE in the update; validation runs before the save |
| 26 | Bad `?page=`, `?limit=`, or non-UUID ids returned 500s | Bounded parsing and UUID checks |
| 27 | Container build failed (`COPY /app/public`, but `public/` didn't exist), and docs were missing from the image | `public/` added; `docs/` and `README.md` are copied in |
| 28 | Polls overlapped and stale responses overwrote newer data | In-flight guard |
| 29 | Copy buttons threw or reported false success over HTTP | `copyText()` with a fallback |
| 30 | An idle second tab logged out the active tab | Shared last-activity via localStorage |
| 31 | Hydration mismatch on the heartbeat time | Formatted on the client only |

## Fake data shown as live

These values were hardcoded and are removed. Missing data now shows "—" or "Unknown":

- Inspector defaults: RSSI −58, SNR 38, "1.2 Gbps"
- A hardcoded `SG2218P / Port 9 / ER7206` uplink path
- WAN "24 ms / 0% loss / 100% uptime / Starlink"
- Report defaults: 9 APs, 4 switches, uptime "10d 4h", site "The Farm"
- Report "Mbps" figures, which were actually PHY link rates in Kbps
- Signal % compared against dBm thresholds, so every client was rated "Excellent"

## Known, not fixed

- The last-admin check is count-then-write, not a transaction, so two admins demoting each other at the same instant could race.
- Topology, devices and PoE payloads still carry site-wide client counts for scoped users.
- Gateway WAN `portStats` field names are best-effort and not yet verified against a live controller. Each field falls back to "Unknown".
- The PoE view assumes 65 W when a switch reports no budget, and the inspector shows "VLAN 1" when no VLAN is reported.
- AI feedback/suppression is stored only in the browser for the session; nothing is sent to the server.
- 9 dev-only npm advisories remain in the vitest/eslint tooling; they don't affect the runtime.
