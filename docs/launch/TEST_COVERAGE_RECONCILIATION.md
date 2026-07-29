# Test coverage reconciliation

Date: 2026-07-29

Baseline commit: parent of `ced5af9ca074e988fdc683e462171bc0ae508def`

Audited commit: `ced5af9ca074e988fdc683e462171bc0ae508def`

## Numerical reconciliation

The earlier 914-test result and the later 896-test result are consistent:

| Change | Test cases |
|---|---:|
| Earlier reported total | 914 |
| Removed with four obsolete test files | -22 |
| Added in `lib/features.test.ts` | +3 |
| Added in `test/payout-source-of-truth.test.ts` | +1 |
| Added in `lib/delivery-estimate-response.test.ts` during this audit | +4 |
| Final verified total | 900 |

Therefore: `914 - 22 + 4 + 4 = 900`. The intermediate 896 report was
correct before this audit added four regression cases. The final file count is
139: the intermediate 138 files plus the new delivery-estimate parser test.

## Removed files and case-by-case disposition

### `lib/feed/customer-mode.test.ts` — 2 tests

The production module `lib/feed/customer-mode.ts` was deleted in the same commit. It was a temporary customer-only presentation filter containing exact IDs, handles, text fragments, names, and hashtags for QA records.

| Removed test | Production behaviour | Classification | Equivalent coverage / loss decision |
|---|---|---|---|
| `blocks exact internal and QA records only` | Hid a hard-coded official fixture ID and records matching QA naming/content markers. | `TESTED_OBSOLETE_IMPLEMENTATION` | The underlying hard-coded production filter no longer exists. Current feed loading requires published, non-deleted posts and applies relationship blocking in `lib/feed/service.ts`; publishing authorization remains covered by `lib/feed/permissions.test.ts`. Preserving a regression assertion for deleted fixture identifiers would re-introduce the obsolete implementation. No launch behaviour was lost. |
| `keeps discovery filtered only for explicit QA markers` | Hid hard-coded “Super Admin”/placeholder markers and removed `placeholder` from trends. | `TESTED_OBSOLETE_IMPLEMENTATION` | Test/QA records must be controlled as data, not recognized by customer-facing string heuristics. Feed publishing authorization and ranking remain tested. No required customer-order journey depends on this deleted heuristic. |

These cases did not test authorization or database isolation. They tested string-based cleanup of known fixtures and are not suitable security substitutes.

### `lib/feed/entitlements.test.ts` — 3 tests

The production module `lib/feed/entitlements.ts` was deleted in the same commit. It was a second, feed-local entitlement catalogue. The active entitlement and quota decisions are now made by `lib/premium.ts`, `lib/feed/quota.ts`, `lib/feed/video-management.ts`, and feed publisher permissions.

| Removed test | Production behaviour | Classification | Equivalent coverage / loss decision |
|---|---|---|---|
| `grants role defaults without premium` | Looked up static feed-local role defaults. | `TESTED_OBSOLETE_IMPLEMENTATION` | Active publisher role rules are covered by `lib/feed/permissions.test.ts`; active video limits are covered by `lib/feed/quota.test.ts`. |
| `honours premium and explicit overrides` | Enabled keys through the deleted feed-local premium/override object. | `TESTED_OBSOLETE_IMPLEMENTATION` | Premium is disabled for launch. Where premium state is still read defensively, active quota/status behaviour has dedicated tests. The removed generic override was not an authorization boundary. |
| `returns the configured defaults for a role` | Returned the deleted static entitlement list. | `TESTED_OBSOLETE_IMPLEMENTATION` | There is intentionally no replacement list API. Keeping this assertion would create a second source of truth. |

No valuable launch regression coverage was lost: the removed assertions targeted an implementation that should not exist, while the active permission and quota implementations retain targeted tests.

### `lib/study-cache.test.ts` — 11 tests

The deleted file contained three `normalizeConcept` cases, five `cacheKey` cases, and three `withCache` cases. They covered normalization, deterministic SHA-256 cache keys, cache hits, cache misses, and write-through behaviour for the removed Study AI response cache.

All 11 cases are classified `FEATURE_DISABLED_AND_TEST_NOT_REQUIRED`. The corresponding `lib/study-cache.ts` production module and Study routes were removed, and the `study` feature is explicitly fail-closed and default-off in `lib/features.test.ts`. None of these helpers is imported by ordering, pricing, payment, delivery, settlement, or launch feed code. Recreating them solely to retain test count would restore a disabled, non-MVP implementation.

### `lib/study-cap.test.ts` — 6 tests

The deleted file contained one Lagos-calendar case and five practice-cap cases: exact free cap, no increment after cap, per-user isolation, next-day reset, and custom cap.

All 6 cases are classified `FEATURE_DISABLED_AND_TEST_NOT_REQUIRED`. They tested the removed Study practice limiter in `lib/study-cap.ts`, not a shared commerce rate limit. The `study` flag’s default-off and unknown-flag fail-closed behaviour remain tested in `lib/features.test.ts`. Commerce request limits use separate implementations and tests, so no ordering or payment regression coverage was removed.

## Added coverage

- `lib/features.test.ts` adds 3 cases: Study remains default-off, sponsor top-up remains default-off, and unknown feature keys fail closed.
- `test/payout-source-of-truth.test.ts` adds 1 architecture regression case ensuring the payment-release cron delegates to the authoritative payout implementation instead of duplicating vendor settlement arithmetic.
- `lib/delivery-estimate-response.test.ts` adds 4 cases for the checkout response
  boundary: accepts finite non-negative distance, rejects a missing distance,
  rejects a string distance, and rejects negative/NaN/infinite values. These
  preserve the mobile browser fix for the former `distanceKm.toFixed` crash.

## Conclusion

No removed test is classified `COVERAGE_LOST_RESTORE_REQUIRED`; therefore none is restored. The 18 Study cases covered code that was removed and remains disabled, while the 4 feed cases covered two deleted interim abstractions. Active feed authorization, feed ranking, relationship blocking, premium quota handling, feature fail-closed behaviour, and payout source-of-truth constraints remain independently tested.

The final clean-install Vitest run passed 139 files and 900 tests in 53.29
seconds. No valuable regression coverage was lost.
