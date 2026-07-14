import { User } from 'lucide-react'

export function DefaultAvatar({
  className = '',
  size = 16,
}: {
  className?: string
  size?: number
}) {
  return (
    <div
      className={className}
      style={{
        display: 'grid',
        placeItems: 'center',
        width: '100%',
        height: '100%',
        borderRadius: '9999px',
        background:
          'radial-gradient(circle at 50% 30%, rgba(255,255,255,0.09), transparent 42%), linear-gradient(180deg, rgba(20,18,15,0.98), rgba(10,9,8,0.98))',
        color: 'rgba(247,242,234,0.52)',
      }}
      aria-hidden="true"
    >
      <User size={size} strokeWidth={1.8} aria-hidden="true" />
    </div>
  )
}
