# Ratings System

## Overview
Customer rates vendors and riders after order completion. 1-5 stars, optional text feedback. Vendor ratings feed directly into ranking algorithm. Rider ratings visible to admins only.

## When Rating Appears
After order hits COMPLETED status → show prompt on order status page. Also appears on order history for any unrated completed order.

## What Gets Rated

| Target | Required | Scope |
|--------|----------|-------|
| Vendor | Yes | Quality, accuracy, speed, packaging |
| Rider | Optional | Only if order had a rider assigned |
| Feedback | No | Max 150 chars, text-only |

## Rules
- **One rating per order** — cannot change after submission
- **Vendor average** recalculated after every new rating
- **Rider average** recalculated after every new rating
- **Ratings below 3** → flagged for admin review automatically
- **Show vendor average** on homepage card and menu page
- **"New" badge** shown until 5+ ratings (no public average yet)
- **Rider average** visible to admins only (internal metric)

## API Route

### POST /api/orders/[id]/rate
```json
Body: { 
  vendor_stars: number, 
  rider_stars?: number, 
  feedback?: string 
}
```

```
1. Verify auth (customer)
2. Ownership check: order.customer_id = session.user_id (or guest phone match)
3. Status check: order must be COMPLETED
4. Idempotency: reject if rating already exists for this order
5. Validate: vendor_stars 1-5, rider_stars 1-5 if provided, feedback <= 150 chars
6. BEGIN TRANSACTION
7. INSERT into ratings
8. UPDATE vendors: avg_rating = avg, total_ratings = count
9. UPDATE riders: avg_rating = avg, total_ratings = count (if applicable)
10. If vendor_stars < 3 OR rider_stars < 3: trigger admin review flag
11. Award customer XP: +5 XP for rating
12. COMMIT
13. Check for "Critic" badge (rated every order for 30 days)
14. Return updated averages
```

## Database Schema

```sql
CREATE TABLE ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id TEXT UNIQUE NOT NULL REFERENCES orders(id),
  customer_id TEXT NOT NULL,
  vendor_id TEXT NOT NULL,
  rider_id TEXT,
  vendor_stars INT NOT NULL CHECK (vendor_stars BETWEEN 1 AND 5),
  rider_stars INT CHECK (rider_stars BETWEEN 1 AND 5),
  feedback TEXT CHECK (char_length(feedback) <= 150),
  flagged_for_review BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ratings_vendor ON ratings(vendor_id, created_at DESC);
CREATE INDEX idx_ratings_rider ON ratings(rider_id, created_at DESC);
CREATE INDEX idx_ratings_flagged ON ratings(flagged_for_review) 
  WHERE flagged_for_review = TRUE;
```

## Recalculation Function

```typescript
async function recalculateVendorRating(vendorId: string) {
  const result = await supabase
    .from('ratings')
    .select('vendor_stars')
    .eq('vendor_id', vendorId);

  if (!result.data || result.data.length === 0) return;

  const total = result.data.length;
  const sum = result.data.reduce((a, r) => a + r.vendor_stars, 0);
  const avg = sum / total;

  await supabase
    .from('vendors')
    .update({
      avg_rating: parseFloat(avg.toFixed(1)),
      total_ratings: total,
      updated_at: new Date().toISOString()
    })
    .eq('id', vendorId);
}

async function recalculateRiderRating(riderId: string) {
  const result = await supabase
    .from('ratings')
    .select('rider_stars')
    .eq('rider_id', riderId)
    .not('rider_stars', 'is', null);

  if (!result.data || result.data.length === 0) return;

  const total = result.data.length;
  const sum = result.data.reduce((a, r) => a + r.rider_stars, 0);
  const avg = sum / total;

  await supabase
    .from('riders')
    .update({
      avg_rating: parseFloat(avg.toFixed(1)),
      total_ratings: total,
      updated_at: new Date().toISOString()
    })
    .eq('id', riderId);
}
```

## Display Rules
- **Average format**: 1 decimal (e.g., 4.8)
- **With count**: "4.8 (247 ratings)"
- **"NEW" badge**: shown if total_ratings < 5
- **Location**: Homepage vendor card + menu page + vendor profile
- **Rider average**: hidden from customers, visible in admin dashboard only

## Security Rules
1. **ALWAYS** verify customer completed the order before allowing rating
2. **NEVER** allow rating same order twice — check if rating already exists
3. **NEVER** expose customer identity in rating (show as "Anonymous")
4. One rating = one submission — no edits after creation
5. Ratings < 3 → auto-flag for admin review (potential quality issues)
6. Dispute takes precedence: if order has active dispute, hide rating UI
7. XP awarded immediately on submission (audit log entry)
8. Recalculation triggers immediately (not queued)
9. Feedback text is permanent (needed for disputes/audits)
