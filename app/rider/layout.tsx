import { FaceGate } from '@/components/face-gate'
import { BankGate } from '@/components/bank-gate'

// Every rider page is gated, in order: KYC selfie → verified payout bank. A rider
// must clear both before they can use the app, go online or accept deliveries
// (applies to all riders, new and existing). Admins/super-admins are exempt
// (handled in each gate's status endpoint + the operation endpoints).
export default function RiderLayout({ children }: { children: React.ReactNode }) {
  return (
    <FaceGate>
      <BankGate>{children}</BankGate>
    </FaceGate>
  )
}
