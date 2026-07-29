# Dependency security decision

Date: 2026-07-29
Decision: `PATCH_AVAILABLE_APPLY`

## Production audit finding

The pre-remediation command `npm.cmd audit --omit=dev --json` reported two high-severity package entries representing one underlying advisory:

| Advisory | Package and installed version | Vulnerable range | Dependency path | Exposure | Decision |
|---|---|---|---|---|---|
| [GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj), covering inherited libvips CVE-2026-33327, CVE-2026-33328, CVE-2026-35590 and CVE-2026-35591 | `sharp@0.34.5` | `<0.35.0` | `lumex-fud > next@16.2.12 > sharp@0.34.5` | Runtime image decoding/processing in the Next image optimizer. This application allows Next Image to optimize menu/vendor images from its constrained `*.supabase.co/storage/v1/object/public/**` remote pattern. Those images originate from controlled upload routes but include customer/vendor-supplied bytes, so untrusted decoding is reachable and cannot be dismissed as build-only. | `PATCH_AVAILABLE_APPLY` |
| Same advisory, surfaced by npm as an effect on `next` | `next@16.2.12` | npm’s derived affected range included this release because its optional Sharp dependency resolved below 0.35.0 | direct `next`, via its nested Sharp | Next itself was not assigned a separate vulnerability. The finding was the reachable nested image processor above. | `PATCH_AVAILABLE_APPLY` |

The application’s direct `sharp@0.35.3` was already patched, but npm had installed Next’s semver-compatible `sharp@0.34.5` as a separate nested copy. `npm.cmd ls next sharp --all` proved that exact path.

## Primary-source assessment

- The [GitHub reviewed advisory](https://github.com/advisories/GHSA-f88m-g3jw-g9cj) states that Sharp versions below 0.35.0 are affected when processing untrusted input, identifies 0.35.0 as the first patched version, recommends current 0.35.3, and identifies libvips 8.18.3.
- The [Sharp 0.35.0 maintainer release](https://github.com/lovell/sharp/releases/tag/v0.35.0) records the libvips 8.18.3 upgrade and the Node.js requirement of at least 20.9.0. This repository requires Node.js 22 or newer, so the engine change is compatible.
- npm metadata before the change showed Next 16.2.12 resolving its optional Sharp copy to 0.34.5. The app already had an explicit 0.35.3 dependency and exercised that version successfully.

## Options considered

| Option | Impact |
|---|---|
| Accept as unreachable | Rejected. Remote Supabase menu/vendor images are processed by Next’s runtime optimizer, so uploaded image bytes can reach Sharp. Upload MIME/magic checks reduce exposure but do not make decoding unreachable. |
| Disable optimization or block vulnerable formats | Could mitigate but would add deployment/performance behaviour changes and would still retain a known vulnerable runtime package. The advisory’s `sharp.block` workaround would also require controlling the exact instance loaded by Next. |
| Downgrade Next to npm audit’s suggested 14.2.35 | Rejected as an unsafe semver-major framework reversal unrelated to the root cause. It would carry high application and App Router regression risk. |
| Upgrade Next broadly | Rejected because no framework upgrade is needed to remove the vulnerable transitive package, and broad upgrades are outside this audit. |
| Force all Sharp consumers to the already-declared patched 0.35.3 | Selected. It is narrow, reproducible in the lockfile, satisfies the repository’s Node engine, and can be validated with the complete suite and production build. |

## Applied remediation and proof

`package.json` now contains an exact top-level npm override, `"sharp": "0.35.3"`. The regenerated lockfile removes the entire `node_modules/next/node_modules/sharp` 0.34.5 subtree (562 lockfile lines) and deduplicates Next onto the application’s patched Sharp:

```text
next@16.2.12
└── sharp@0.35.3 deduped
sharp@0.35.3 overridden
```

Runtime inspection reports Sharp `0.35.3` with libvips `8.18.3`. The post-remediation `npm.cmd audit --omit=dev --json` result is 0 production vulnerabilities. Compatibility remains subject to the final clean install, unit/integration suite, Playwright suite, typecheck, lint, and production build recorded in `MVP_CERTIFICATION_V2.md`.

No audit force-fix, Next downgrade, broad dependency upgrade, or advisory suppression was used.

## Development-only audit result

The final unfiltered `npm.cmd audit --json` reports 9 high package entries, but
they are effects of one development-tool advisory:

| Advisory | Installed vulnerable path | Function and reachability | Decision |
|---|---|---|---|
| [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg) / `brace-expansion` denial of service through unbounded expansion | `eslint@9.39.4` and `eslint-config-next@16.2.12` → `minimatch@3.1.5` → `brace-expansion@1.1.17`; npm expands the effect graph into `minimatch`, ESLint plugins/config packages, and ESLint, producing 9 entries | Build/development lint only. ESLint runs against fixed repository-owned paths from the local command/CI workflow. No HTTP request, image, user upload, webhook, payment data, or database value can provide the glob pattern. Production installs made with omitted dev dependencies do not include this path. | `NOT_REACHABLE_ACCEPT_WITH_EVIDENCE` |

The current dependency graph already contains fixed `minimatch@10.2.5` with
`brace-expansion@5.0.8` for unrelated tooling, but ESLint's older supported
dependency path remains. npm proposes `eslint@10.8.0` (semver-major) and an
incoherent `eslint-config-next@0.2.4` reversal as automated fixes. Applying a
global minimatch override would also cross unsupported major versions inside
ESLint. None is a safe, narrow launch-audit change.

Compensating controls are: lint only a trusted checkout, do not pass
user-controlled path/glob arguments to ESLint, run lint in a memory-limited CI
job, and omit dev dependencies from the production runtime. The successful
repository lint confirms normal compatibility; it does not make an
attacker-controlled glob reachable. Reassess when the installed ESLint/Next
config line publishes a compatible patched chain.

Final outcomes are therefore:

- production audit: 0 vulnerabilities;
- Sharp runtime advisory: `PATCH_AVAILABLE_APPLY`, remediated;
- development glob advisory: `NOT_REACHABLE_ACCEPT_WITH_EVIDENCE`;
- no unresolved exploitable production vulnerability.
