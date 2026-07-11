import type { TrendTone } from './helpers'

const TONE_COLORS: Record<TrendTone, string> = {
  amber: '#F5A623',
  blue: '#60a5fa',
  green: '#4ade80',
  violet: '#a78bfa',
}

export function Sparkline({
  values,
  tone = 'amber',
  className = '',
}: {
  values: number[]
  tone?: TrendTone
  className?: string
}) {
  const clean = values.length > 1 ? values : [0, ...values, 0]
  const max = Math.max(...clean, 1)
  const min = Math.min(...clean, 0)
  const span = Math.max(max - min, 1)
  const points = clean.map((value, index) => {
    const x = (index / Math.max(clean.length - 1, 1)) * 100
    const y = 100 - ((value - min) / span) * 100
    return `${x.toFixed(2)},${y.toFixed(2)}`
  })
  const color = TONE_COLORS[tone]

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`spark-${tone}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.55" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline
        points={`0,100 ${points.join(' ')} 100,100`}
        fill={`url(#spark-${tone})`}
        stroke="none"
      />
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
