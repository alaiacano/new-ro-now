import { useState } from 'react'
import type { PavingEntry } from '../types'

interface Props {
  paving: PavingEntry[]
}

type Filter = 'all' | 'citywide' | 'downtown'

export default function PavingView({ paving }: Props) {
  const [filter, setFilter] = useState<Filter>('all')

  const year = paving.find(p => p.year)?.year ?? '—'
  const filtered = filter === 'all' ? paving : paving.filter(p => p.list === filter)

  // Deduplicate street names for the summary count
  const uniqueStreets = new Set(paving.map(p => p.street)).size

  const FILTERS: Array<{ key: Filter; label: string }> = [
    { key: 'all', label: `All (${paving.length})` },
    { key: 'citywide', label: `Citywide (${paving.filter(p => p.list === 'citywide').length})` },
    { key: 'downtown', label: `Downtown (${paving.filter(p => p.list === 'downtown').length})` },
  ]

  return (
    <div className="section">
      <div className="section-header">
        <h2>Paving Schedule</h2>
        <p>
          {uniqueStreets} streets scheduled for {year} ·{' '}
          <a href="https://www.newrochelleny.gov/948/Paving" target="_blank" rel="noreferrer">
            Paving page ↗
          </a>
          {' '}(includes citywide &amp; downtown PDF downloads)
        </p>
        <p style={{ marginTop: '0.4rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          This is an annual schedule — no specific dates are provided for individual streets.
        </p>
      </div>

      <div className="filter-bar">
        {FILTERS.map(f => (
          <button
            key={f.key}
            className={filter === f.key ? 'selected' : ''}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="empty"><h3>No paving entries found</h3></div>
      )}

      {filtered.map((entry, i) => (
        <div key={i} className="card">
          <div className="card-meta">
            <span className={`tag ${entry.list === 'downtown' ? 'flood' : 'roadway'}`}>
              {entry.list === 'downtown' ? 'Downtown' : 'Citywide'}
            </span>
            {entry.year && <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{entry.year}</span>}
            {entry.coords
              ? <span style={{ color: '#16a34a' }}>📍 Mapped</span>
              : <span style={{ color: '#9ca3af' }}>📍 Location pending</span>
            }
            {entry.note && <span title="Partial block">*</span>}
          </div>
          <div className="card-title">{entry.street}</div>
          {(entry.to || entry.from) && (
            <div className="card-body">
              <p>
                {entry.to && entry.from
                  ? `${entry.to} → ${entry.from}`
                  : entry.to || entry.from}
              </p>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
