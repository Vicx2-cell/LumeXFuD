import type { ButtonHTMLAttributes } from 'react'

/**
 * Segmented pill / toggle button. Drives the repeated active?:inactive
 * styling via data attributes (see `.lx-pill` in globals.css).
 * `variant` only changes the active colour (amber default, safe=green,
 * danger=red). Forwards all native button props.
 */
export function Pill({
  active = false,
  variant = 'amber',
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean
  variant?: 'amber' | 'safe' | 'danger'
}) {
  return (
    <button
      type="button"
      data-active={active}
      data-variant={variant}
      className={`lx-pill ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
