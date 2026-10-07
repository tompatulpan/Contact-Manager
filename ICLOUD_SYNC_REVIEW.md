# iCloud Sync Subsystem Review

**Review date:** 2026-10-07 (revised same day — second pass added IS-10 … IS-14 and corrected the test count)
**Scope:** Everything involved in synchronizing contacts with iCloud CardDAV: `ICloudSyncService`, `ICloudCardDAVClient`, `ICloudConnector`, `ICloudTestController`, `CardDAVConnectorFactory`, the Cloudflare Worker proxy, and the Baikal settings-UI routing that touches iCloud.
**Method:** Static review of current `main` (through `9630716`), with runtime claims verified against actual method existence and call sites, and the jest suite executed (`npm test`: 8 suites / 43 tests pass; of those, 7 suites / 36 tests are `tests/icloud/`). Supersedes section 8 of `FEATURE_CLEANUP_AND_REVIEW.md` where they differ.

## 1. Two paths exist; only one works

```text
PATH A (working):  iCloud Sync button (index.html #icloud-test-btn)
    → ICloudTestController (modal UI)
    → ICloudSyncService            (pull / deletions / push, dual timers)
    → ICloudCardDAVClient          (CardDAV: PROPFIND, REPORT, PUT, DELETE)
    → Cloudflare Worker (carddav-proxy)  → contacts.icloud.com

PATH B (broken):   CardDAV settings UI (Baikal modal)
    → BaikalUIController (icloud.com URL detection)
    → ICloudConnector              → contact-carddav-bridge-lite (node bridge, browser-imported)
    → Worker                        → iCloud
```

`CardDAVConnectorFactory` is instantiated in `app.js` but `createConnector()` has **zero callers** — the factory is dead code.

## 2. What Path A actually implements (verified)

| Behavior | Status | Notes |
|---|---|---|
| Principal + addressbook discovery | Implemented | `ICloudCardDAVClient.discoverPrincipal/` `discoverAddressBook` via Worker proxy |
| Full addressbook pull | Implemented | REPORT, UID-based matching against local contacts |
| Pull authority | Implemented | Owned/imported contacts updated from iCloud; shared contacts never pulled (CM is authority) |
| Remote deletion → local delete | Implemented | Any owned contact with a stored ETag that is missing from the server snapshot is deleted locally (`handleDeletions`) |
| Local deletion → remote delete | Implemented | `pushToICloud` phase 0: DELETE with ETag, then hard `userbase.deleteItem` with 1.1 s rate limiting and a `TooManyRequests` retry |
| ETag optimistic concurrency on push | **Implemented in client only — defeated by the Worker in production** | Client sets `If-Match` on PUT/DELETE and handles 412 (covered by `conflicts.test.js`), but the Worker does not forward `If-Match` to iCloud, so iCloud never sees the precondition and never returns 412. See IS-10. `createContact` also sends no `If-None-Match: *`, so a create can silently overwrite a same-UID contact. |
| Immediate push after local edit | Implemented | `ContactManager.updateContact/createContact` → `pushSingleContact` |
| Auto-sync | Implemented, with a timer leak | Dual timer: 10 min bidirectional (owned/imported) + 15 min shared force-push, 5 min offset (`PERFORMANCE_CONFIG.icloud*`). The modal's interval input overrides only the bidirectional timer. The offset `setTimeout` is not cancellable — see IS-12. |
| Shared contact refresh | Implemented | `refreshSharedContactsToICloud` force-pushes shared contacts (owner authority) |
| Pause/resume around bulk ops | Implemented, triggers an extra full sync per resume | `ContactManager` calls `stopAutoSync()`/`startAutoSync()` around bulk operations; `startAutoSync()` always runs an immediate `performSync()` and re-arms the offset timer (IS-12) |
| Sync statistics + events | Implemented | `SyncStatistics` + `icloud:sync*` events consumed by the modal |
| Credential persistence | **Not implemented for Path A** | `SecureCredentialStorage`/`CredentialStorageUI` are wired only into `BaikalUIController` (Path B). The iCloud modal holds credentials in memory; auto-sync does not survive a page reload. See IS-14. |

## 3. Findings

### IS-01 (P0): Path B is broken at three independent points

**Evidence:**

1. `BaikalUIController.js:589` calls `this.iCloudConnector.connect(config)` where `config` is the settings form (`serverUrl`, `username`, `password`, `profileName`). `ICloudConnector.connect()` expects `{ appleId, appSpecificPassword }` and immediately reads `credentials.appleId` → every attempt fails validation.
2. `BaikalUIController.js:872` reads `this.iCloudConnector.connections` — `ICloudConnector` never creates a `connections` Map. The `&&` guard makes this fail silently.
3. `BaikalUIController.js:1172/1178` call `getConnectionStatus(profileName)` and `pushAllContacts(profileName)` — **neither method exists** on `ICloudConnector` (it exposes `getStatus()`, `fetchContacts()`, `pushContact()`, `sync()`). Any push from the settings UI to an iCloud profile throws `TypeError`.

**Conclusion:** iCloud profiles created through the CardDAV settings UI cannot connect, cannot report status, and cannot push. The only working entry point is the iCloud Sync modal.

**Required cleanup:** Remove Path B (`ICloudConnector`, `CardDAVConnectorFactory`, the iCloud branches in `BaikalUIController`), or route settings-UI iCloud profiles through `ICloudSyncService`. Removal is recommended: Path A is tested (36/36 in `tests/icloud/`) and Path B has been broken through multiple refactors. Note that Path B is also the only place `SecureCredentialStorage` is wired in (IS-14) — removing it must not be read as "credential storage is done".

### IS-02 (P0, security): Worker token is a public secret

`src/config/app.config.js:25` hardcodes `workerToken`, which is committed to git and shipped in the public JS bundle. The Worker rejects requests without it (`carddav-proxy.js:42-56`), but anyone can extract the token from the deployed bundle. The token therefore blocks nothing except token-less scrapers, while advertising the proxy as an anonymizing relay to `contacts.icloud.com` (an attacker can forward arbitrary `Authorization` headers at iCloud without revealing their own IP).

Mitigating factors: the Worker's SSRF allowlist restricts targets to `contacts.icloud.com`/`caldav.icloud.com` over `https:` only, and it strips CR/LF from the forwarded `Authorization` header. The `Origin` check (`isAllowedOrigin`) is a plain header comparison — it stops browsers on foreign origins, but any non-browser client can set `Origin: https://e2econtacts.org` and pass. It is not a security boundary against scripted abuse. `app.config.js` already carries a comment saying the token is "visible in the JS bundle"; the comment is accurate but the Worker still treats the token as if it were the primary gate.

**Required cleanup:**
- Rotate the token (current value is in git history permanently).
- Add Cloudflare rate limiting / WAF rule on the Worker route — this is the only control that actually bounds relay abuse.
- Keep the existing "not a secret" comment in `app.config.js`, and mirror it in `cloudflare-worker/README.md` so the deployment story matches.

### IS-03 (P1): `CardDAVConnectorFactory` is dead

Instantiated in `app.js:148`, never used. `createConnector()`, `detectServerType()`, `getServerConfig()`, `validateConnectionParams()` have no callers. Delete together with IS-01.

### IS-04 (P1): `cleanupOrphanedDeletions()` is unreachable manual tooling

No production caller — only `console.warn` hints to run it by hand (`ICloudSyncService.js:1462`, `SyncStatistics.js:165`). It also duplicates the hard-delete logic in `pushToICloud()` and directly calls global `userbase.deleteItem`. Either delete it, or surface it as an explicit maintenance action (button) — do not leave it as a zombie method that shares deletion semantics with the live path.

The two hints also disagree, and one is wrong: `ICloudSyncService.js:1462` tells the user to run `window.app.modules.iCloudSyncService.cleanupOrphanedDeletions()`, but `window.app` is never assigned anywhere in `src/` — only `window.iCloudSyncService` is (`app.js:89`). Following the hint as printed throws `TypeError`.

### IS-05 (P1): Global `userbase` in the sync service

`pushToICloud()` and `cleanupOrphanedDeletions()` call `userbase.deleteItem` directly, bypassing `ContactDatabase`. This forces tests to stub a browser global and creates a second persistence path. Inject the database (or a deletion callback) instead.

### IS-06 (P1): BaikalConnector shares the iCloud-only proxy

`app.js` passes the same `cardDAVProxyConfig` (same Worker URL) to `BaikalConnector`. The Worker rejects any non-iCloud target, so remote generic CardDAV sync can never traverse the proxy (local servers bypass it). This is the root of the earlier CD-02 finding and is why "sync with any CardDAV server" only works on localhost today. The generic CardDAV feature needs its own transport decision (separate worker with per-host allowlist, or a bridge service) — not this Worker.

### IS-07 (P2): `ICloudCardDAVClient.proxyFetch` reads a nonexistent `this.config`

`this.config?.cardDAV?.workerToken` — the client has no `config` property; the expression survives only through the `APP_CONFIG` fallback. Harmless, but misleading; simplify to read `APP_CONFIG` directly.

### IS-08 (P2): Remote-deletion detection trusts one full REPORT

`handleDeletions` deletes any ETag-tracked owned contact absent from the current server snapshot. If a future change makes `fetchContacts()` return a partial or empty result without throwing (pagination, server quirk), local data is deleted based on a false absence signal. Add an explicit "snapshot is complete" guarantee (e.g., contact count sanity check, or only run deletion detection when the pull phase fully succeeded) before treating absence as deletion. The present-day instance of this failure mode is IS-11 (an ETag that was never an iCloud ETag).

### IS-09 (P2): Two sources of connection truth in the iCloud modal

`ICloudTestController.testConnect()` builds its own `ICloudCardDAVClient` and reports success independently of `ICloudSyncService.initialize()`. A user can see "connection OK" in the test log while the sync service is not initialized (`startAutoSync()` in the controller calls `service.initialize()` if `!isConnected`, so it self-heals, but the duplicated connection logic invites drift). Route all connection through the service; make `testConnect` call `service.initialize()`.

### IS-10 (P0, data integrity): Worker strips `If-Match` — ETag concurrency is a no-op in production

`ICloudCardDAVClient.updateContact()` and `deleteContact()` set `If-Match: <etag>` (`ICloudCardDAVClient.js:641-643`, `678-680`), and `ICloudSyncService` has a full 412 re-fetch-and-retry path (`pushSingleContact`, `pushToICloud` ~line 710). But the Worker rebuilds the outbound request with a fixed header set — `Authorization`, `Content-Type`, `Depth`, `User-Agent`, `Accept` (`carddav-proxy.js:91-100`) — and **does not forward `If-Match`, `If-None-Match`, or `Prefer`**, even though all three are advertised in `Access-Control-Allow-Headers` (`carddav-proxy.js:144`).

Consequences:
- iCloud never receives a precondition, so it never returns 412. Every PUT is an unconditional overwrite; every DELETE is unconditional. A contact edited on an iPhone between pull and push is silently replaced by the Contact Manager version (last-writer-wins, no detection).
- `conflicts.test.js` passes because it mocks the client; it cannot see the header being dropped one hop later. The 412 code path has never executed against real iCloud through this Worker.
- The "DELETE with ETag" row in section 2 is therefore only true at the client boundary.

**Required cleanup:** Forward `If-Match` / `If-None-Match` / `Prefer` when present (one small change in the Worker), redeploy, and add a Worker-level test or a manual `diagnose-worker.html` step that asserts a stale `If-Match` returns 412. Also send `If-None-Match: *` from `createContact()` so creates cannot clobber an existing UID.

### IS-11 (P1, data loss): `metadata.carddav.etag` is shared between Baikal and iCloud

Both sync paths write the same field with no profile/server discriminator: `ContactManager.updateContactCardDAVMetadata()` (used by `BaikalConnector.js:1081`, `1793`) spreads the existing `carddav` object and overwrites `etag`/`href`; `ICloudSyncService` writes `carddav = { source: 'iCloud', etag, href, … }` (`ICloudSyncService.js:332`, `377`, `543`, …). Nothing reads `source`.

If a user has a Baikal/Nextcloud profile and iCloud sync active at the same time:
- `handleDeletions` treats "has `carddav.etag`" as "was synced to iCloud" (`ICloudSyncService.js:450-461`). A contact that was only ever pushed to Baikal is absent from the iCloud snapshot → **deleted locally**, and the deletion is then pushed back to Baikal on the next Baikal cycle.
- `pushSingleContact` sends the Baikal ETag as `If-Match` to iCloud. Today this is masked by IS-10 (the header is dropped); once IS-10 is fixed it becomes a permanent 412 loop until the ETag is refreshed.

**Required cleanup:** Namespace CardDAV sync state per target (e.g., `metadata.carddav.icloud = {…}`, `metadata.carddav.baikal[profileName] = {…}`) or, minimally, make `handleDeletions`/`pushSingleContact` require `carddav.source === 'iCloud'`. Add a test with a Baikal-tagged contact that must survive an iCloud deletion pass.

### IS-12 (P1): Shared-refresh offset timer leaks across pause/resume

`startAutoSync()` arms `setTimeout(() => { refreshShared…(); this.sharedRefreshInterval = setInterval(…) }, sharedOffsetMs)` (`ICloudSyncService.js:135-142`) but never stores the timeout handle, and `stopAutoSync()` only clears the two intervals (`:154-170`). The guard at the top of `startAutoSync()` checks only `this.syncInterval`.

`ContactManager` pauses/resumes auto-sync around bulk operations by calling exactly `stopAutoSync()` → `startAutoSync()` (`ContactManager.js:113-116`, `152-155`). Any pause/resume that lands inside the 5-minute offset window leaves the old `setTimeout` live; when it fires it force-pushes all shared contacts and creates a second `sharedRefreshInterval` that overwrites the handle of the first, so the first can never be cleared. Each leaked interval adds another 15-minute force-push of every shared contact for the life of the tab. Additionally, every resume runs an immediate `performSync()` (full pull + deletion pass + push), which the bulk operation was trying to avoid.

**Required cleanup:** Store the timeout handle, clear it in `stopAutoSync()`, guard on both timers, and give `startAutoSync()` an option to skip the initial `performSync()` when resuming.

### IS-13 (P2): Worker source is duplicated and `wrangler.toml` is out of sync with it

- `cloudflare-worker-carddav-proxy.js` (repo root) and `cloudflare-worker/carddav-proxy.js` are byte-identical today and both tracked in git. `wrangler.toml` deploys only the latter. The root copy will drift the first time someone edits one and not the other — delete it.
- `wrangler.toml` defines `ALLOWED_CARDDAV_SERVERS` (including `p01…p08-contacts.icloud.com`, `127.0.0.1`, `localhost`), but the Worker never reads it; it uses the hardcoded `ALLOWED_ICLOUD_HOSTNAMES` (`carddav-proxy.js:17-20`). The client deliberately rewrites partition hosts back to `contacts.icloud.com` (`discoverAddressBook` extracts `pathname` only), so the hardcoded list is what actually works — the env var is dead config that misdescribes the allowlist (and would allow `localhost` if it were ever honored). Remove it or make the Worker read it.
- `ALLOWED_ORIGINS` is likewise defined both in `wrangler.toml` and as a constant in the Worker; the code tolerates either form, but only one should be the source of truth.

### IS-14 (P2): Path A has no credential persistence

`SecureCredentialStorage` / `CredentialStorageUI` are imported and used only by `BaikalUIController` (Path B). `ICloudTestController` reads the Apple ID and app-specific password from the modal inputs each time and `ICloudSyncService` keeps them in `this.credentials` in memory. A page reload or new tab loses them, auto-sync stops, and nothing tells the user. Combined with IS-01 this means **no working iCloud flow can remember credentials today**. When Path B is removed, wire `CredentialStorageUI.showStorageConsent()` / `getStoredCredentials()` into the iCloud modal so the "private browsing" storage story described in the project docs applies to iCloud too.

## 4. Test coverage

| Area | Coverage |
|---|---|
| `ICloudSyncService` pull / push / deletion / 412 conflicts / orphans / shared refresh / email fields | Good at the unit level — 7 suites, 36 tests, all passing, via mocked client (`tests/icloud/`). The 8th suite / remaining 7 tests are `tests/dedup.test.js`, unrelated to iCloud. |
| `ICloudCardDAVClient` (XML parsing, discovery, ETag handling, proxy URL building) | None — only manual diagnostic pages (`tests/manual/`) |
| Cloudflare Worker | None. This is where IS-10 hides: the mocked client "sends" `If-Match` and the suite is green, but the real hop drops it. |
| Multi-profile interaction (Baikal + iCloud on the same contact set) | None — IS-11 is not covered |
| Timer lifecycle (`startAutoSync`/`stopAutoSync` re-entrancy) | None — IS-12 is not covered |
| `ICloudConnector` (Path B) | None — and the code is broken, so untestable as-is |
| `ICloudTestController` | None |

## 5. Recommended consolidation plan (in order)

1. **Fix the Worker header forwarding** (IS-10) — forward `If-Match`, `If-None-Match`, `Prefer`; add `If-None-Match: *` to `createContact()`; redeploy. Smallest change in this list and the only one that stops silent overwrites of iPhone edits.
2. **Delete Path B** (IS-01, IS-03) — remove `ICloudConnector.js`, `CardDAVConnectorFactory.js`, and the iCloud branches in `BaikalUIController` (connect routing at ~589, profile lookup at ~872, push routing at ~1166-1190). Also stop instantiating them in `app.js`. Surviving behavior is covered by the jest suite.
3. **Decide the settings-UI story**: either disable iCloud URLs in the CardDAV settings form with a pointer to the iCloud Sync button, or make the settings UI initialize `ICloudSyncService` for iCloud profiles. Whichever is chosen, wire `CredentialStorageUI` into the iCloud flow (IS-14) so credentials survive a reload.
4. **Namespace CardDAV sync state per target** (IS-11) and make `handleDeletions` only consider iCloud-sourced ETags. Do this before enabling Baikal and iCloud simultaneously for any user.
5. **Fix the timer lifecycle** (IS-12) — store/clear the offset timeout, guard both timers, skip the initial sync on resume.
6. **Token hygiene** (IS-02): rotate the Worker token, add Cloudflare rate limiting. The `app.config.js` comment already states the token is visible; mirror it in `cloudflare-worker/README.md`.
7. **Remove or surface `cleanupOrphanedDeletions`** (IS-04, incl. the wrong `window.app` hint) and inject the database into the service instead of the `userbase` global (IS-05).
8. **Harden deletion detection** (IS-08) with a completeness guard on the pull snapshot.
9. **De-duplicate the Worker source and reconcile `wrangler.toml`** (IS-13).
10. **Extend tests** to `ICloudCardDAVClient` using the existing XML fixtures in `tests/icloud/fixtures/carddav-responses.js`, add a Worker header-forwarding test, a Baikal-tagged-contact-survives-iCloud-deletion test (IS-11), and a stop/start re-entrancy test (IS-12).

Steps 1, 2, 4 and 6 are the ones that matter before the next production sync; the rest can follow incrementally.
