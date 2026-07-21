# Role-permission matrix

Initial roles found: unauthenticated, customer, vendor, rider, admin, super_admin. Page-prefix expectations are evidenced at `proxy.ts:7-29`; API classifications are centralized at `lib/authz-policy.ts:25-136`. Applicant/support/fraud/operations subroles are not yet proven as distinct authoritative roles. Object-level permissions and RLS allow/deny evidence remain pending.
