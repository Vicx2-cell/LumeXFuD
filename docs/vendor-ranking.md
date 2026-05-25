# Vendor Performance Ranking

## Overview
Every successful marketplace controls vendor visibility. LumeX ranks vendors by performance. Quality rises. Poor performers fade. Platform stays excellent. Vendors don't need to know the algorithm—results speak for themselves.

## The Four Scores (recalculated after every completed order)

### 1. Speed Score (0-100)
```
speed_score = (orders_delivered_by_stated_prep_time / total_orders) × 100
```
- **Target**: 85+
- **Below 60**: admin warning notification
- **Below 40**: temporary visibility penalty (-20% combined score)

### 2. Rating Score (0-100)
```
rating_score = (avg_customer_rating / 5) × 100
```
- **Minimum 5 ratings** required before score activates
- **Until 5 ratings**: rating_score = 75 (neutral default)
- **Below 3.0 avg**: admin review triggered automatically

### 3. Reliability Score (0-100)
```
reliability_score = ((orders_accepted - orders_cancelled_by_vendor) / orders_received) × 100
```
- Auto-cancelled by vendor (didn't accept in 5 mins): -5 points each
- **Target**: 90+

### 4. Demand Score (0-100)
```
demand_score = (vendor_orders_last_7_days / max_orders_any_vendor_last_7_days) × 100
```
- Relative measure (prevents new vendors from being buried)
- Higher demand = higher visibility

## Combined Visibility Score
```
visibility_score = (Speed × 0.35) + (Rating × 0.30) + (Reliability × 0.25) + (Demand × 0.10)
```

## Performance Tiers

| Tier | Score Range | Badge | Features |
|------|-------------|-------|----------|
| Bronze | 0-59 | None | Standard visibility |
| Silver | 60-74 | "Quality" | Slightly boosted |
| Gold | 75-89 | "Top Rated" | Prominently featured |
| Elite | 90-100 | "Elite" | Top of homepage |

- Tier badge shown on vendor card on homepage
- Tier recalculates **weekly Sunday midnight**

## Homepage Sort Order
**Default**: `visibility_score DESC` (NOT alphabetical, NOT by subscription tier, NOT by newest)

**Filters customers can apply**:
- "Open Now" (default)
- Category (Rice, Protein, Drinks, Snacks)
- Sort: Top Rated / Fastest / Cheapest / Nearest (V2 with location)

## Admin Manual Boost
- **Used for**: new vendor launch, promotional event, recovery after dispute
- **Effect**: Boosted vendors appear in top 3 regardless of score
- **Duration**: 24 hours (auto-expires)
- **Audit**: All boosts logged to `audit_logs`

## Cron Job (Weekly Sunday Midnight)

```typescript
// /api/cron/recalculate-vendor-scores
async function recalculateAllVendorScores() {
  // 1. Get all active vendors
  const vendors = await db.vendors.findMany({ 
    where: { is_active: true } 
  });

  // 2. Find max orders in last 7 days (for demand normalization)
  const maxOrders = await db.orders.findMaxByVendorLast7Days();

  for (const vendor of vendors) {
    // Speed score
    const orders = await db.orders.findMany({
      where: {
        vendor_id: vendor.id,
        status: 'COMPLETED',
        created_at: { gte: thirtyDaysAgo }
      }
    });

    const onTime = orders.filter(o =>
      o.delivered_at <= addMinutes(o.created_at, vendor.prep_time_minutes + 10)
    ).length;

    const speedScore = orders.length > 0 ? (onTime / orders.length) * 100 : 75;

    // Rating score
    const ratings = await db.ratings.findMany({ 
      where: { vendor_id: vendor.id } 
    });
    const ratingScore = ratings.length >= 5
      ? (ratings.reduce((s, r) => s + r.vendor_stars, 0) / ratings.length / 5) * 100
      : 75;

    // Reliability score
    const received = await db.orders.count({ 
      where: { 
        vendor_id: vendor.id, 
        created_at: { gte: thirtyDaysAgo } 
      } 
    });
    const cancelled = await db.orders.count({
      where: { 
        vendor_id: vendor.id, 
        status: 'CANCELLED',
        cancellation_reason: { 
          in: ['VENDOR_REJECTED', 'AUTO_CANCEL_TIMEOUT'] 
        },
        created_at: { gte: thirtyDaysAgo } 
      }
    });
    const reliabilityScore = received > 0 
      ? ((received - cancelled) / received) * 100 
      : 75;

    // Demand score
    const recent = await db.orders.count({
      where: { 
        vendor_id: vendor.id, 
        created_at: { gte: sevenDaysAgo } 
      }
    });
    const demandScore = maxOrders > 0 ? (recent / maxOrders) * 100 : 50;

    // Combined
    const combined = (speedScore * 0.35) + (ratingScore * 0.30) + 
      (reliabilityScore * 0.25) + (demandScore * 0.10);

    // Tier
    let tier = 'BRONZE';
    if (combined >= 90) tier = 'ELITE';
    else if (combined >= 75) tier = 'GOLD';
    else if (combined >= 60) tier = 'SILVER';

    // Upsert
    await db.vendor_scores.upsert({
      where: { vendor_id: vendor.id },
      data: {
        speed_score: speedScore,
        rating_score: ratingScore,
        reliability_score: reliabilityScore,
        demand_score: demandScore,
        combined_score: combined,
        performance_tier: tier,
      }
    });

    // Alerts
    if (speedScore < 60) {
      await sendWhatsApp(vendor.phone, 
        `Speed score warning: ${speedScore.toFixed(0)}/100. Improve delivery times to maintain visibility.`);
    }
  }
}
```

## Database Schema

```sql
CREATE TABLE vendor_scores (
  vendor_id TEXT PRIMARY KEY REFERENCES vendors(id),
  speed_score DECIMAL(5,2) DEFAULT 75.00,
  rating_score DECIMAL(5,2) DEFAULT 75.00,
  reliability_score DECIMAL(5,2) DEFAULT 75.00,
  demand_score DECIMAL(5,2) DEFAULT 50.00,
  combined_score DECIMAL(5,2) DEFAULT 70.00,
  performance_tier TEXT NOT NULL DEFAULT 'BRONZE' 
    CHECK (performance_tier IN ('BRONZE','SILVER','GOLD','ELITE')),
  manual_boost_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_vendor_scores_combined ON vendor_scores(combined_score DESC);
```

## Homepage Query

```typescript
async function getHomepageVendors() {
  const { data } = await supabase
    .from('vendors')
    .select(`
      id, name, logo_url, prep_time_minutes,
      status, paused_until, avg_rating, total_ratings,
      vendor_scores ( performance_tier, combined_score, manual_boost_until )
    `)
    .eq('is_active', true)
    .eq('status', 'OPEN')
    .order('vendor_scores.combined_score', { ascending: false });

  // Pin boosted vendors to top
  const boosted = data.filter(v => 
    v.vendor_scores?.manual_boost_until > new Date()
  );
  const regular = data.filter(v => 
    !v.vendor_scores?.manual_boost_until || v.vendor_scores.manual_boost_until <= new Date()
  );

  return [...boosted, ...regular];
}
```

## Security Rules
1. **ALWAYS** recalculate after every completed order (not just weekly)
2. **ALWAYS** verify order status before counting toward scores
3. **NEVER** allow manual boost without audit log entry
4. Speed score uses prep_time_minutes + 10-min grace (rider delays not vendor fault)
5. Demand score normalized by max (prevents new vendors from being buried)
6. Rating score only activates with 5+ ratings (prevents gaming with 1 order)
7. Tier recalculation is deterministic (same inputs = same tier every time)
8. Visibility penalty for speed < 40 is applied immediately (not weekly)
9. Admin boosts expire after 24 hours (automatic)

## Database Tables
- `vendor_scores` - All metrics (updated every 30 mins)
- `vendor_daily_stats` - Daily snapshots for trending
- `vendor_boosts` - Manual boost history

## Cron Jobs
- `POST /api/cron/recalculate-vendor-scores` - Every Sunday midnight
- `POST /api/cron/release-payments` - Every minute (tied to score)

## Security Rules
- NEVER hardcode score weights (store in settings table)
- ALWAYS verify score before showing vendor on homepage
- NEVER expose scoring formula to vendors (prevent gaming)
- All score changes logged to audit_logs
- Score calculation must be deterministic and reproducible
