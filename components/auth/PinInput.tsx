'use client'

import { useRef, useEffect, useState } from 'react'

interface PinInputProps {
  value: string
  onChange: (value: string) => void
  onComplete?: (value: string) => void
  error?: string
  disabled?: boolean
  label?: string
  length?: number
}

export default function PinInput({
  value,
  onChange,
  onComplete,
  error,
  disabled,
  label,
  length = 6,
}: PinInputProps) {
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  // Ensure inputRefs length matches length prop
  useEffect(() => {
    inputRefs.current = inputRefs.current.slice(0, length)
  }, [length])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === 'Backspace' && !value[index] && index > 0) {
      // Focus previous input on backspace if current is empty
      inputRefs.current[index - 1]?.focus()
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>, index: number) => {
    const val = e.target.value
    if (!/^\d*$/.test(val)) return // Only allow digits

    const newValue = value.split('')
    // Take only the last character if multiple are pasted or typed
    newValue[index] = val.slice(-1)
    const updatedValue = newValue.join('').slice(0, length)
    
    onChange(updatedValue)

    // Auto-focus next input
    if (val && index < length - 1) {
      inputRefs.current[index + 1]?.focus()
    }

    // Check if complete
    if (updatedValue.length === length && onComplete && val) {
      onComplete(updatedValue)
    }
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault()
    if (disabled) return

    const pastedData = e.clipboardData.getData('text').slice(0, length)
    if (!/^\d+$/.test(pastedData)) return

    onChange(pastedData)
    
    // Focus the last input or the next available one
    const nextIndex = Math.min(pastedData.length, length - 1)
    inputRefs.current[nextIndex]?.focus()

    if (pastedData.length === length && onComplete) {
      onComplete(pastedData)
    }
  }

  return (
    <div className="space-y-4">
      {label && (
        <label className="block text-center text-xs font-medium text-white/60 mb-2">
          {label}
        </label>
      )}
      
      <div className="flex justify-center gap-3">
        {Array.from({ length }).map((_, i) => (
          <input
            key={i}
            ref={(el) => { inputRefs.current[i] = el }}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={1}
            value={value[i] || ''}
            onChange={(e) => handleChange(e, i)}
            onKeyDown={(e) => handleKeyDown(e, i)}
            onPaste={handlePaste}
            onFocus={() => setFocusedIndex(i)}
            onBlur={() => setFocusedIndex(null)}
            disabled={disabled}
            className="w-14 h-16 text-center text-2xl font-bold rounded-xl transition-all outline-none"
            style={{
              background: '#111113',
              border: `1px solid ${
                error 
                  ? '#ef4444' 
                  : focusedIndex === i 
                    ? '#F5A623' 
                    : 'rgba(255,255,255,0.1)'
              }`,
              color: '#fff',
              boxShadow: focusedIndex === i ? '0 0 0 1px rgba(245, 166, 35, 0.2)' : 'none'
            }}
          />
        ))}
      </div>

      {error && (
        <p className="text-center text-sm text-red-400 mt-2">{error}</p>
      )}
    </div>
  )
}
