interface SparklineProps {
  data: number[]
  width?: number
  height?: number
  /** Stroke/fill colour. */
  color?: string
  className?: string
}

/**
 * Lightweight inline-SVG sparkline (area + line + "you are here" dot) — the
 * single highest-impact "this is a real dashboard" move. No chart library.
 * Server-safe. Renders responsively (preserveAspectRatio none) so it fills its
 * container width.
 */
export function Sparkline({ data, width = 280, height = 60, color = '#F5A623', className = '' }: SparklineProps) {
  if (data.length < 2) return null
  const max = Math.max(...data)
  const min = Math.min(...data)
  const span = max - min || 1
  const nx = (i: number) => (i / (data.length - 1)) * width
  const ny = (v: number) => height - ((v - min) / span) * (height - 8) - 4
  const line = data.map((v, i) => `${i ? 'L' : 'M'}${nx(i).toFixed(1)},${ny(v).toFixed(1)}`).join(' ')
  const area = `${line} L${width},${height} L0,${height} Z`
  const lastX = nx(data.length - 1)
  const lastY = ny(data[data.length - 1])
  const gid = `lx-spark-${Math.round(data.reduce((a, b) => a + b, 0))}-${data.length}`

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      fill="none"
      aria-hidden="true"
      className={`lx-spark ${className}`}
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={lastX} cy={lastY} r="2.6" fill={color} />
    </svg>
  )
}
