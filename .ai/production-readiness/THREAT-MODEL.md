# Threat model

Pending Phase 4. Priority assets are sessions/roles, personal and location data, rider documents, orders/chat/handover codes, payment and ledger records, admin privileges, service/webhook secrets and evidence logs. Initial concrete attack surface includes 231 API handlers, direct anon Supabase/realtime access, privileged service-role paths, webhooks, cron endpoints, uploads, old PWA clients and third-party callbacks.
