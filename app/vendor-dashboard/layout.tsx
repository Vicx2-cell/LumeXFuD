import { FaceGate } from '@/components/face-gate'
import { BankGate } from '@/components/bank-gate'
import { VendorDashboardShell } from '@/components/vendor-dashboard/shell'

// Every vendor page is gated, in order: KYC selfie → verified payout bank. A
// vendor must clear both before they can use the dashboard or open for orders
// (applies to all vendors, new and existing). Admins/super-admins are exempt
// (handled in each gate's status endpoint + the operation endpoints).
export default function VendorDashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <FaceGate>
      <BankGate>
        <VendorDashboardShell>{children}</VendorDashboardShell>
      </BankGate>
    </FaceGate>
  )
}
