# Feed ranking and pins

The feed combines official scoped pins, published posts, location relevance,
availability, freshness, real conversion/popularity, affordability, and manual
content. Existing scoring remains transparent in `lib/feed/ranking.ts`.

Rules added for automation:

- At offset zero, the highest-priority active pin matching global, city, campus,
  or delivery-area scope is moved to the top.
- A pinned post is removed from its chronological position before prepend, so
  it is never immediately duplicated.
- Only live, published, non-archived official posts can be pinned.
- One primary pin is enforced per scope by a unique database index. A new pin
  server-side unpins and audits the previous one.
- Start and expiry are server evaluated; the worker automatically expires pins.
- Vendor fair rotation selects one candidate per vendor per pass. Existing
  ranking also caps consecutive posts, preventing high-volume domination.
- Availability and area filtering happen before affordability or popularity
  uplift. Paid preference is not added by automation.

When insufficient posts exist, structured discovery cards use live marketplace
records and are not stored as posts.
