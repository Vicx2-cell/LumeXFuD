# Test matrix

Current automated baseline: 91 discovered `.test.ts` files; Vitest ran 91 files/702 tests, with 698 passing. Existing suites include authz/access control, RLS coverage, payment/webhook/money paths, wallets, handover, order state/chat/realtime/lifecycle/performance/accessibility/responsiveness, feed, validation and business logic.

Iteration 1: 94 test files and 721/721 tests pass. Email verification targeted tests prove public signup, privileged-purpose denial, admin allowance, fail-closed rate limiting, proof-cookie creation only after a valid code, and purpose/address binding. Handover plus access-control suites passed 215/215 in three consecutive runs.

Required isolated identities remain unconfirmed: visitor, customer A/B, vendor A/B, rider A/B, reassigned rider, suspended user, admin and superadmin. Browser, offline/resume, multiple-device, concurrency, preview and deployed-RLS proof remain pending.
