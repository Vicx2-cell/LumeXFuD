'use client'

interface SecurityQuestionSelectProps {
  label: string
  value: string
  options: string[]
  otherValue?: string
  onChange: (value: string) => void
  disabledOptions?: string[]
}

export default function SecurityQuestionSelect({
  label,
  value,
  options,
  otherValue,
  onChange,
  disabledOptions = [],
}: SecurityQuestionSelectProps) {
  return (
    <label className="block text-sm text-white/70">
      <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-white/40">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-2xl border border-white/10 bg-[#111113] px-4 py-3 text-sm text-white outline-none"
      >
        <option value="">Select a question</option>
        {options.map((question) => (
          <option key={question} value={question} disabled={disabledOptions.includes(question)}>
            {question}
          </option>
        ))}
      </select>
      {otherValue && <p className="mt-2 text-xs text-white/40">{otherValue}</p>}
    </label>
  )
}
