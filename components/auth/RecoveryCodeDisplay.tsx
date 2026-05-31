'use client'

interface RecoveryCodeDisplayProps {
  code: string
  onSaved?: () => void
}

export default function RecoveryCodeDisplay({ code, onSaved }: RecoveryCodeDisplayProps) {
  const handleCopy = async () => {
    await navigator.clipboard.writeText(code)
    if (onSaved) onSaved()
  }

  const handleDownload = () => {
    const blob = new Blob([
      `Your LumeX recovery code:\n${code}\n\nSave this code somewhere safe. You will need it if you forget your PIN and security answers.`
    ], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'lumex-recovery-code.txt'
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
    if (onSaved) onSaved()
  }

  return (
    <div className="space-y-4 rounded-3xl border border-white/10 bg-white/5 p-6">
      <p className="text-sm text-white/60">Recovery code</p>
      <div className="rounded-2xl bg-slate-950/90 p-4 text-center text-lg font-semibold tracking-wider text-amber-200">
        {code}
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={handleCopy}
          className="w-full rounded-xl bg-amber-500 py-3 text-sm font-semibold text-black"
        >
          Copy code
        </button>
        <button
          type="button"
          onClick={handleDownload}
          className="w-full rounded-xl border border-white/10 py-3 text-sm text-white"
        >
          Download text file
        </button>
      </div>
      <p className="text-sm text-white/50">
        Save this code somewhere safe. You will need it if you forget your PIN and security answers.
      </p>
    </div>
  )
}
