# Historical secret response

## Conclusion

`ALL_HISTORICAL_CREDENTIALS_CONFIRMED_REVOKED`

No currently usable credential was found in the reachable Git history. Two real
Vercel workload-identity tokens were committed in `9e0d7213642b`; both are
cryptographically expired. All other credential-shaped matches were empty values,
documented placeholders, test data, public configuration, or false positives.

This conclusion is about repository evidence. It does not claim that production
provider configuration has been exercised.

## Method

The audit inspected every reachable branch and tag with `git log --all
--full-history -p`, concentrating on environment files, Vercel diagnostic output,
workflows, and documentation. Added lines were checked for:

- Paystack live/test key prefixes;
- JWTs;
- GitHub, Resend, and Sentry token prefixes;
- assignments to names containing `SECRET`, `TOKEN`, `KEY`, or `PASSWORD`.

Matches were deduplicated by SHA-256. A second working-tree scan searched strong
provider prefixes while excluding `.git`, dependencies, and the lockfile. It
found no credential. The apparent `re_` matches were substrings in SQL function
names, not Resend keys. No full credential was printed during the audit.

## Credential findings

| Service | Environment | Type | Commit / path | Redacted fingerprint | Validity | Shared history |
|---|---|---|---|---|---|---|
| Vercel | project `lume-x` | OIDC workload token | `9e0d7213642b` / `.vercel-env-check` | `sha256:5b6c1558f9… / …8cKQ` | Issued 2026-07-09 07:04:29Z; expired 2026-07-09 19:04:29Z | Yes, reachable from the configured GitHub remote |
| Vercel | production target | OIDC workload token | `9e0d7213642b` / `.vercel-env-prod-check` | `sha256:74977ace23… / …rw_w` | Issued 2026-07-09 07:05:25Z; expired 2026-07-09 19:05:25Z | Yes, reachable from the configured GitHub remote |

JWT issuer, audience, issue time, and expiry were decoded locally without
recording the token. Vercel issued both tokens with twelve-hour lifetimes. Their
signed `exp` claims are in the past, so they cannot authenticate now. The files
are absent from the current tree.

## Non-credential matches

- `.vercel-env-prod-check` contained empty values for Paystack, Supabase,
  Upstash, WhatsApp, encryption, cron, and Sentry secrets. Empty strings are not
  credentials.
- `.env.example` values such as `replace_with_a_long_random_secret`,
  `your_webhook_secret`, and example JWT text are explicit templates.
- Test and workflow values use dummy/test placeholders and are not accepted as
  evidence of a provider credential.
- `NEXT_PUBLIC_*` URLs and intentionally public Supabase/Paystack client keys
  were still checked for accidental secret substitution; none was found.

## Response and history disposition

No owner revocation action is required for the two expired OIDC tokens, and no
history rewrite is recommended. Rewriting shared history would create
coordination risk without reducing present exposure. If a provider later reports
that either fingerprint remained usable despite its signed expiry, revoke it
first and obtain explicit owner approval before rewriting history.

Future Vercel environment diagnostics must be treated as secret-bearing output
and must never be committed, even when most fields are blank.
