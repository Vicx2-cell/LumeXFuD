# Gamification System

## Overview
Customer rewards for repeat ordering, engagement, and social sharing. Drives retention and viral growth.

## Subsystems
- XP (Experience Points)
- Streaks and milestones
- Badges and achievements
- Weekly leaderboard
- Levels and rewards

## XP System

### XP Earning
- Place order: +10 XP (base)
- Order delivered: +5 XP
- Complete ratings: +10 XP
- Refer friend: +50 XP (if friend completes order)
- Social share: +25 XP

### XP Multipliers
- Streak active (3+ orders/week): 1.5x
- New vendor (first time): 1.2x
- High-spend order (₦2,000+): 1.3x

### Level Progression
```
Level 1: 0 XP
Level 2: 100 XP
Level 3: 250 XP
Level 4: 500 XP
Level 5: 1000 XP
Level 6: 1500 XP
Level 7: 2500 XP
Level 8: 4000 XP
Level 9: 6000 XP
Level 10: 10000 XP (max)
```

## Streaks

### Active Streak
- +1 day for every order placed within 24 hours
- Reset to 0 if no order for 24+ hours
- Display on profile: "🔥 7-day streak"

### Streak Milestones (with rewards)
- 3-day: +50 XP + "Consistent" badge
- 7-day: +150 XP + "Weekly Warrior" badge + ₦100 credit
- 14-day: +300 XP + "Two-Week Legend" badge + ₦250 credit
- 30-day: +500 XP + "Monthly Master" badge + ₦500 credit + "30-Day Veteran" profile badge

## Badges

### Earned Badges
- **First Bite**: Place first order
- **Consistent**: 3-day streak
- **Weekly Warrior**: 7-day streak
- **Two-Week Legend**: 14-day streak
- **Monthly Master**: 30-day streak
- **Foodie**: Order from 10 different vendors
- **Explorer**: Order from all categories
- **Rating Master**: Leave 50+ ratings
- **Helpful**: Assist 5+ vendors via reviews
- **Social Butterfly**: Refer 3+ friends
- **Loyal Customer**: 100 orders

### Rare Badges (earned during events)
- **Midnight Snacker**: Order between 9pm-6am
- **Early Bird**: Order before 9am
- **Speed Eater**: Complete order in < 15 mins
- **Big Spender**: Single order > ₦5,000

## Weekly Leaderboard

### Calculation
- Every Monday midnight: reset weekly stats
- Rank customers by total XP earned this week
- Top 10 displayed on leaderboard page

### Rewards
```
#1: +500 XP + "Weekly Champion" badge + ₦1,000 credit
#2: +300 XP + ₦500 credit
#3: +150 XP + ₦250 credit
#4-10: +50 XP each
```

### Reset
```
POST /api/cron/reset-weekly-leaderboard (Monday midnight)
1. Calculate final scores
2. Award prizes
3. Notify top 10 via WhatsApp
4. Archive scores to leaderboard_history
5. Reset weekly_xp to 0 for all customers
```

## Gamification Profile Display
```
Profile shows:
- Level indicator with progress bar
- Current streak with 🔥 emoji
- Total XP (lifetime)
- Last 5 badges earned
- Weekly rank (if in top 10)
- Stats: Total orders, favorite vendor, most ordered item
```

## Database Tables
- `customer_xp` - XP per customer (lifetime + weekly)
- `customer_badges` - Earned badges per customer
- `badges` - Badge definitions and requirements
- `customer_streaks` - Active streak tracking
- `leaderboard_weekly` - Current week ranking
- `leaderboard_history` - Past week archives

## Notification Triggers
- Level up: WhatsApp + in-app toast
- Badge earned: In-app celebration animation
- Streak milestone: WhatsApp alert
- Leaderboard entry: WhatsApp + app notification
- Leaderboard reward: Direct payment to wallet

## Security Rules
- ALWAYS verify order before awarding XP
- XP cannot be manually edited (super_admin logged)
- Streaks calculated server-side (not client)
- Referral XP only if referred friend completes order
- Badge earning verified before assignment
