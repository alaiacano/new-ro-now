import type { ReactNode } from 'react'
import { ExternalLink as ExternalIcon } from 'lucide-react'

import { YEAR_OPTS, yearLabel, type YearOption } from './format'

export type { YearOption }

/** Compact select for the "show from" year filter. */
export function YearPicker({ value, onChange, options = YEAR_OPTS }: {
  value: YearOption
  onChange: (y: YearOption) => void
  options?: YearOption[]
}) {
  return (
    <label className="year-picker">
      <span className="visually-hidden">Show items from</span>
      <select
        value={String(value)}
        onChange={e => {
          const v = e.target.value
          onChange(v === 'upcoming' ? 'upcoming' : v === 'null' ? null : Number(v))
        }}
      >
        {options.map(y => (
          <option key={String(y)} value={String(y)}>{yearLabel(y)}</option>
        ))}
      </select>
    </label>
  )
}

export function ViewHeader({ title, sub, aside }: {
  title: string
  sub?: ReactNode
  aside?: ReactNode
}) {
  return (
    <header className="view-header">
      <div>
        <h1>{title}</h1>
        {sub && <p className="view-sub">{sub}</p>}
      </div>
      {aside && <div className="view-aside">{aside}</div>}
    </header>
  )
}

export interface Chip<K extends string> {
  key: K
  label: string
  count?: number
}

export function Chips<K extends string>({ items, value, onChange, label }: {
  items: Chip<K>[]
  value: K
  onChange: (k: K) => void
  label: string
}) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {items.map(c => (
        <button
          key={c.key}
          type="button"
          className="chip"
          aria-pressed={value === c.key}
          onClick={() => onChange(c.key)}
        >
          {c.label}
          {c.count !== undefined && <span className="chip-count">{c.count}</span>}
        </button>
      ))}
    </div>
  )
}

/** Calendar-page style date: weekday / big day number / month. */
export function DateStamp({ iso, tone }: { iso: string | null | undefined; tone?: 'work' }) {
  const d = iso ? new Date(iso) : null
  if (!d || isNaN(d.getTime())) {
    return <div className="date-stamp unknown" aria-label="Date unknown">?</div>
  }
  return (
    <time className={`date-stamp${tone ? ' ' + tone : ''}`} dateTime={d.toISOString()}>
      <span className="ds-dow">{d.toLocaleDateString('en-US', { weekday: 'short' })}</span>
      <span className="ds-day">{d.getDate()}</span>
      <span className="ds-mon">{d.toLocaleDateString('en-US', { month: 'short' })}</span>
    </time>
  )
}

export function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="ext-link" href={href} target="_blank" rel="noreferrer">
      {children}
      <ExternalIcon size={13} aria-hidden="true" />
    </a>
  )
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {hint && <p>{hint}</p>}
    </div>
  )
}

/** Shown for DocumentCenter items, whose date came from LLM extraction. */
export function DocSource({ folder, date }: { folder?: string; date?: string | null }) {
  return (
    <span className="doc-source">
      From city documents{folder ? `, ${folder}` : ''}
      {date ? null : <span className="doc-nodate"> (no date found)</span>}
    </span>
  )
}
