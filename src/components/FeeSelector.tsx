import type { FeeRates, FeeLevel } from '../types'

interface Props {
  feeRates: FeeRates | null
  selected: FeeLevel
  onSelect: (level: FeeLevel) => void
  customRate: number
  onCustomRateChange: (rate: number) => void
  loading: boolean
}

const FEE_INFO: Record<Exclude<FeeLevel, 'custom'>, { label: string; time: string }> = {
  rapid: { label: 'Fast', time: '~10 min' },
  normal: { label: 'Normal', time: '~30 min' },
  slow: { label: 'Slow', time: '~1 hr' },
}

export function FeeSelector({ feeRates, selected, onSelect, customRate, onCustomRateChange, loading }: Props) {
  if (loading || !feeRates) {
    return (
      <div className="space-y-2">
        <label className="text-sm font-medium dark:text-slate-200">Fee Rate</label>
        <div className="text-sm text-ink/50 dark:text-slate-400">Loading fee rates...</div>
      </div>
    )
  }

  const presetLevels: Exclude<FeeLevel, 'custom'>[] = ['rapid', 'normal', 'slow']

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium dark:text-slate-200">Fee Rate</label>

      <div className="space-y-1">
        {presetLevels.map((level) => (
          <label
            key={level}
            className={`flex items-center gap-3 p-2 rounded cursor-pointer transition-colors ${
              selected === level ? 'bg-ink/5 dark:bg-slate-700' : 'hover:bg-ink/3 dark:hover:bg-slate-800'
            }`}
          >
            <input
              type="radio"
              name="feeLevel"
              checked={selected === level}
              onChange={() => onSelect(level)}
              className="accent-ink dark:accent-slate-300"
            />
            <span className="font-medium dark:text-slate-200">{FEE_INFO[level].label}</span>
            <span className="text-ink/60 dark:text-slate-400">{feeRates[level]} sat/vB</span>
            <span className="text-ink/40 dark:text-slate-500 text-sm">{FEE_INFO[level].time}</span>
          </label>
        ))}

        <label
          className={`flex items-center gap-3 p-2 rounded cursor-pointer transition-colors ${
            selected === 'custom' ? 'bg-ink/5 dark:bg-slate-700' : 'hover:bg-ink/3 dark:hover:bg-slate-800'
          }`}
        >
          <input
            type="radio"
            name="feeLevel"
            checked={selected === 'custom'}
            onChange={() => onSelect('custom')}
            className="accent-ink dark:accent-slate-300"
          />
          <span className="font-medium dark:text-slate-200">Custom</span>
          <input
            type="number"
            min={1}
            step="0.1"
            value={Number.isFinite(customRate) ? customRate : ''}
            onChange={(e) => {
              const v = parseFloat(e.target.value)
              onCustomRateChange(Number.isFinite(v) && v > 0 ? v : 0)
              if (selected !== 'custom') onSelect('custom')
            }}
            onFocus={() => {
              if (selected !== 'custom') onSelect('custom')
            }}
            className="w-20 px-2 py-0.5 rounded border border-ink/20 dark:border-slate-600 bg-white dark:bg-slate-900 dark:text-slate-200 text-sm tabular-nums"
            aria-label="Custom fee rate in sat/vB"
          />
          <span className="text-ink/60 dark:text-slate-400">sat/vB</span>
        </label>
      </div>
    </div>
  )
}
