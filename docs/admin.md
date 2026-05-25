# Admin & Super Admin System

## Overview
Two-tier admin separation: operational admins for daily management, super admin for financial/system decisions.

## Roles

### Admin
- Operational management
- ADMIN_PHONE environment variable
- Can view orders, disputes, vendors, riders
- Can resolve disputes (customer favor / vendor favor)
- Can pause/suspend vendors
- Cannot access financials
- Cannot change settings
- Cannot manage other admins

### Super Admin
- God mode
- SUPER_ADMIN_PHONE environment variable (Chibuike)
- Can do everything admin can do
- Can access all financials
- Can change system settings
- Can boost vendors (₦5,000 cost)
- Can approve/deny wallet withdrawals
- Can manually refund orders
- Can view audit logs
- Can manage other admins

## Key Routes

### Admin Routes
- `GET /api/admin/dashboard` - Daily metrics
- `GET /api/admin/vendors` - List all vendors
- `PATCH /api/admin/vendors/[id]` - Pause/suspend/approve
- `GET /api/admin/riders` - List all riders
- `PATCH /api/admin/riders/[id]` - Suspend/unlock
- `GET /api/admin/orders` - View all orders
- `GET /api/admin/disputes` - List active disputes
- `POST /api/admin/disputes/[id]/resolve` - Resolve dispute
- `GET /api/admin/audit` - View audit logs

### Super Admin Routes
- `GET /api/super-admin/financials` - Revenue, costs, margins
- `PATCH /api/super-admin/settings` - Change system settings
- `POST /api/super-admin/team` - Manage admin team
- `GET /api/super-admin/super-audit` - Audit super admin actions

## Admin Dashboard

### Daily Metrics (must show)
```
Orders today
Profit per order (target: positive)
Average delivery time (target: < 25 mins)
Riders online right now
Active disputes (target: zero)
Wallet float (vendor + rider held funds)
Paystack balance verification status
```

### Weekly Review
```
Repeat order rate (target: 40%+)
Revenue per vendor (concentration check)
Rider retention vs last week
Vendor complaints
```

### Monthly Review
```
GMV (Gross Merchandise Value)
Take rate (target: 15-20%)
Customer churn rate
Vendor subscription MRR
```

## Dispute Resolution

### Process
```
1. Customer initiates dispute within 15 mins of DELIVERED
2. Dispute status = OPEN
3. Admin reviews:
   - Order messages
   - Photos from customer
   - Vendor explanation
   - Order history
4. Admin decides: CUSTOMER_FAVOR or VENDOR_FAVOR
5. If CUSTOMER_FAVOR:
   - Refund full order to customer wallet
   - Deduct from vendor wallet (with hold)
   - Log to audit_logs
   - Notify both parties
6. If VENDOR_FAVOR:
   - Keep payment with vendor
   - Close dispute
   - Notify customer
```

## Vendor Management

### Actions
- **Pause**: Vendor hidden from homepage for 15/30/60 mins (chosen by vendor)
- **Suspend**: Vendor hidden for 24 hours (admin action for rule violation)
- **Approve**: Approve new vendor subscription
- **Reject**: Reject vendor application

### Suspension Triggers
- Dispute rate > 5%
- Food safety complaints
- Rider complaints about vendor
- Non-compliance with operating hours
- Billing issues

## Rider Management

### Actions
- **Suspend**: Rider goes offline, cannot accept orders
- **Unlock**: Re-enable suspended rider
- **Alert**: Send WhatsApp to rider

### Suspension Triggers
- Rating < 2.5
- Customer complaints (rude, lost order)
- Failed deliveries
- Wallet reconciliation issues

## Authentication

### Verification
- Admin login: phone OTP required
- New device: WhatsApp alert sent to ADMIN_PHONE
- Re-auth required for actions > ₦50,000:
  - Manual refund
  - Wallet withdrawal approval
  - Vendor suspension

### Session Management
- JWT in httpOnly cookie (same as customers)
- Role verified on every request
- Log all admin actions to audit_logs
- Log all super admin actions to super_audit_logs

## Audit Logging

### Admin Actions Logged
- Dispute resolutions
- Vendor pause/suspend
- Manual refunds
- Rider actions
- Settings changes

### Super Admin Actions Logged
- All admin actions (automatically)
- Manual boosts
- Settings changes
- Financial approvals
- Team management

## Database Tables
- `admins` - Admin records with roles
- `audit_logs` - Admin action log
- `super_audit_logs` - Super admin action log
- `admin_devices` - Device tracking for new device alerts

## Security Rules
- ALWAYS verify role from JWT before allowing action
- ALWAYS check ADMIN_PHONE or SUPER_ADMIN_PHONE for re-auth
- NEVER expose admin functions to customers/vendors/riders
- All admin actions logged immutably
- Admin cannot delete logs (append-only)
- Re-auth required for critical actions (> ₦50,000)
- New device login triggers WhatsApp alert
