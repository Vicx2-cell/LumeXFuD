import { FaceGate } from '@/components/face-gate'

// Every vendor page is gated: a vendor must have a KYC photo on file before they
// can use the dashboard (applies to all vendors, new and existing). Admins/
// super-admins viewing this section are exempt (handled in the status endpoint).
export default function VendorDashboardLayout({ children }: { children: React.ReactNode }) {
  return <FaceGate>{children}</FaceGate>
}
