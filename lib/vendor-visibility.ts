// ─── Vendor public visibility ────────────────────────────────────────────────
// A vendor an admin has SUSPENDED (via /api/admin/suspend, which sets
// `suspended_until`) must vanish from every customer-facing surface — the
// homepage list, the storefront page, the public API and the /uturu SEO pages —
// not merely be blocked at login. Those queries already gate on
// `is_active = true AND deleted_at IS NULL`; add this clause so a currently-
// suspended vendor is excluded too.
//
// Returned as a PostgREST `.or()` string: "no suspension" OR "suspension already
// expired". Milliseconds are stripped from the timestamp so the value carries no
// dots — keeping the `column.op.value` parsing unambiguous.

export function notCurrentlySuspendedOr(): string {
  const nowNoMillis = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  return `suspended_until.is.null,suspended_until.lt.${nowNoMillis}`
}
