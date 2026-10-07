# iCloud Sync Subsystem Review

**Review date:** 2026-10-07
**Scope:** Everything involved in synchronizing contacts with iCloud CardDAV: `ICloudSyncService`, `ICloudCardDAVClient`, `ICloudConnector`, `ICloudTestController`, `CardDAVConnectorFactory`, the Cloudflare Worker proxy, and the Baikal settings-UI routing that touches iCloud.
**Method:** Static review of current `main` (through `c765a0e`), with runtime claims verified against actual method existence and call sites. Supersedes section 8 of `FEATURE_CLEANUP_AND_REVIEW.md` where they differ.

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
| ETag optimistic concurrency on push | Implemented | 412 triggers re-fetch and retry (covered by `conflicts.test.js`) |
| Immediate push after local edit | Implemented | `ContactManager.updateContact/createContact` → `pushSingleContact` |
| Auto-sync | Implemented | Dual timer: 10 min bidirectional (owned/imported) + 15 min shared force-push, 5 min offset (`PERFORMANCE_CONFIG.icloud*`) |
| Shared contact refresh | Implemented | `refreshSharedContactsToICloud` force-pushes shared contacts (owner authority) |
| Pause/resume around bulk ops | Implemented | `ContactManager` stops/starts auto-sync around bulk operations |
| Sync statistics + events | Implemented | `SyncStatistics` + `icloud:sync*` events consumed by the modal |

## 3. Findings

### IS-01 (P0): Path B is broken at three independent points

**Evidence:**

1. `BaikalUIController.js:589` calls `this.iCloudConnector.connect(config)` where `config` is the settings form (`serverUrl`, `username`, `password`, `profileName`). `ICloudConnector.connect()` expects `{ appleId, appSpecificPassword }` and immediately reads `credentials.appleId` → every attempt fails validation.
2. `BaikalUIController.js:872` reads `this.iCloudConnector.connections` — `ICloudConnector` never creates a `connections` Map. The `&&` guard makes this fail silently.
3. `BaikalUIController.js:1170/1177` call `getConnectionStatus(profileName)` and `pushAllContacts(profileName)` — **neither method exists** on `ICloudConnector`. Any push from the settings UI to an iCloud profile throws `TypeError`.

**Conclusion:** iCloud profiles created through the CardDAV settings UI cannot connect, cannot report status, and cannot push. The only working entry point is the iCloud Sync modal.

**Required cleanup:** Remove Path B (`ICloudConnector`, `CardDAVConnectorFactory`, the iCloud branches in `BaikalUIController`), or route settings-UI iCloud profiles through `ICloudSyncService`. Removal is recommended: Path A is tested (43/43) and Path B has been broken through multiple refactors.

### IS-02 (P0, security): Worker token is a public secret

`src/config/app.config.js:25` hardcodes `workerToken`, which is committed to git and shipped in the public JS bundle. The Worker rejects requests without it (`carddav-proxy.js:42`), but anyone can extract the token from the deployed bundle. The token therefore blocks nothing except token-less scrapers, while advertising the proxy as an anonymizing relay to `contacts.icloud.com` (an attacker can forward arbitrary `Authorization` headers at iCloud without revealing their own IP).

Mitigating factors: the Worker's SSRF allowlist restricts targets to `contacts.icloud.com`/`caldav.icloud.com`, and CORS origin checks limit browser-based abuse.

**Required cleanup:**
- Rotate the token (current value is in git history permanently).
- Add Cloudflare rate limiting / WAF rule on the Worker route.
- Either document the token as a low-value shared mitigation, or derive a per-session token from the app server. Do not treat it as a secret.

### IS-03 (P1): `CardDAVConnectorFactory` is dead

Instantiated in `app.js:148`, never used. `createConnector()`, `detectServerType()`, `getServerConfig()`, `validateConnectionParams()` have no callers. Delete together with IS-01.

### IS-04 (P1): `cleanupOrphanedDeletions()` is unreachable manual tooling

No production caller — only a `console.warn` hint to run it by hand (`ICloudSyncService.js:1462`, `SyncStatistics.js:165`). It also duplicates the hard-delete logic in `pushToICloud()` and directly calls global `userbase.deleteItem`. Either delete it, or surface it as an explicit maintenance action (button) — do not leave it as a zombie method that shares deletion semantics with the live path.

### IS-05 (P1): Global `userbase` in the sync service

`pushToICloud()` and `cleanupOrphanedDeletions()` call `userbase.deleteItem` directly, bypassing `ContactDatabase`. This forces tests to stub a browser global and creates a second persistence path. Inject the database (or a deletion callback) instead.

### IS-06 (P1): BaikalConnector shares the iCloud-only proxy

`app.js` passes the same `cardDAVProxyConfig` (same Worker URL) to `BaikalConnector`. The Worker rejects any non-iCloud target, so remote generic CardDAV sync can never traverse the proxy (local servers bypass it). This is the root of the earlier CD-02 finding and is why "sync with any CardDAV server" only works on localhost today. The generic CardDAV feature needs its own transport decision (separate worker with per-host allowlist, or a bridge service) — not this Worker.

### IS-07 (P2): `ICloudCardDAVClient.proxyFetch` reads a nonexistent `this.config`

`this.config?.cardDAV?.workerToken` — the client has no `config` property; the expression survives only through the `APP_CONFIG` fallback. Harmless, but misleading; simplify to read `APP_CONFIG` directly.

### IS-08 (P2): Remote-deletion detection trusts one full REPORT

`handleDeletions` deletes any ETag-tracked owned contact absent from the current server snapshot. If a future change makes `fetchContacts()` return a partial or empty result without throwing (pagination, server quirk), local data is deleted based on a false absence signal. Add an explicit "snapshot is complete" guarantee (e.g., contact count sanity check, or only run deletion detection when the pull phase fully succeeded) before treating absence as deletion.

### IS-09 (P2): Two sources of connection truth in the iCloud modal

`ICloudTestController.testConnect()` builds its own `ICloudCardDAVClient` and reports success independently of `ICloudSyncService.initialize()`. A user can see "connection OK" in the test log while the sync service is not initialized (the service re-connects with the same credentials on `startAutoSync`, so it self-heals, but the duplicated connection logic invites drift). Route all connection through the service; make `testConnect` call `service.initialize()`.

## 4. Test coverage

| Area | Coverage |
|---|---|
| `ICloudSyncService` pull / push / deletion / 412 conflicts / orphans / shared refresh / email fields | Good — 8 suites, 43 tests, all passing, via mocked client (`tests/icloud/`) |
| `ICloudCardDAVClient` (XML parsing, discovery, ETag handling, proxy URL building) | None — only manual diagnostic pages (`tests/manual/`) |
| Cloudflare Worker | None |
| `ICloudConnector` (Path B) | None — and the code is broken, so untestable as-is |
| `ICloudTestController` | None |

## 5. Recommended consolidation plan (in order)

1. **Delete Path B** — remove `ICloudConnector.js`, `CardDAVConnectorFactory.js`, and the iCloud branches in `BaikalUIController` (connect routing at ~589, profile lookup at ~872, push routing at ~1160-1190). Also stop instantiating them in `app.js`. Surviving behavior is covered by the jest suite.
2. **Decide the settings-UI story**: either disable iCloud URLs in the CardDAV settings form with a pointer to the iCloud Sync button, or make the settings UI initialize `ICloudSyncService` for iCloud profiles.
3. **Token hygiene** (IS-02): rotate the Worker token, add Cloudflare rate limiting, comment `app.config.js` to state plainly that the token is not a secret.
4. **Remove or surface `cleanupOrphanedDeletions`** (IS-04) and inject the database into the service instead of the `userbase` global (IS-05).
5. **Harden deletion detection** (IS-08) with a completeness guard on the pull snapshot.
6. **Extend tests** to `ICloudCardDAVClient` using the existing XML fixtures in `tests/icloud/fixtures/carddav-responses.js`.

Steps 1 and 3 are the ones that matter before the next production sync; the rest can follow incrementally.
