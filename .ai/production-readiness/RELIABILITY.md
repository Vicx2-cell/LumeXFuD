# Reliability

Baseline release blocker: production build failure. Existing cron/reconciliation, idempotency and order-state code is present but not end-to-end proven. Required interruption scenarios—payment close/loss, duplicate/delayed webhook, database/Redis/provider outage, realtime reconnect, old PWA clients and assignment/chat races—remain pending.
