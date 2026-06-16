import { FaceGate } from '@/components/face-gate'

// Every rider page is gated: a rider must have a KYC photo on file before they
// can use the app (applies to all riders, new and existing). Admins/super-admins
// viewing this section are exempt (handled in the status endpoint).
export default function RiderLayout({ children }: { children: React.ReactNode }) {
  return <FaceGate>{children}</FaceGate>
}
