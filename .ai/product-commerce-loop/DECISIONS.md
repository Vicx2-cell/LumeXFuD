# Product Commerce Loop Decisions

## 2026-07-21

- Preserve all fraud-security and operational readiness work.
- Do not change production deployment or real payment behavior.
- Treat guest checkout as a scoped restoration/integration task because repository docs disagree.
- Start with mobile add-on/cart correctness because it is a direct conversion blocker and the brief calls it out.
- Use additive `group_order_items.addons` JSONB snapshots to preserve shared cart choices without changing the core order/payment architecture.
- Keep the direct group-page add-on picker as the next focused UX slice rather than overexpanding this commit.
