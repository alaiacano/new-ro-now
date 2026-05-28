import { useState } from 'react'
import './App.css'
import { useData } from './useData'
import type { Meta } from './types'
import MapView from './components/MapView'
import MeetingsView from './components/MeetingsView'
import ConstructionView from './components/ConstructionView'
import PavingView from './components/PavingView'
import BidsView from './components/BidsView'
import NewsView from './components/NewsView'

type TabId = 'map' | 'construction' | 'paving' | 'meetings' | 'bids' | 'news'

interface Tab {
  id: TabId
  label: string
}

const TABS: Tab[] = [
  { id: 'map',          label: '🗺 Map' },
  { id: 'construction', label: '🚧 Projects' },
  { id: 'paving',       label: '🛣 Paving' },
  { id: 'meetings',     label: '📅 Meetings' },
  { id: 'bids',         label: '📋 Bids' },
  { id: 'news',         label: '📰 News' },
]

function formatLastUpdated(meta: Meta): string | null {
  const dates = Object.values(meta).filter((v): v is string => Boolean(v))
  if (!dates.length) return null
  const latest = dates.sort().at(-1) as string
  try {
    return 'Updated ' + new Date(latest).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })
  } catch { return null }
}

const YEAR_OPTS: Array<number | null> = [2026, 2025, 2024, 2023, 2022, null]  // null = All

export default function App() {
  const [tab, setTab] = useState<TabId>('map')
  const [fromYear, setFromYear] = useState<number | null>(2025)
  const { data, loading, error } = useData()

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text-muted)' }}>
        Loading…
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: '2rem', maxWidth: 600, margin: '0 auto' }}>
        <h2>Could not load data</h2>
        <p style={{ color: 'var(--text-muted)', marginTop: '0.5rem' }}>{error}</p>
        <p style={{ marginTop: '1rem', fontSize: '0.9rem' }}>
          Run <code style={{ background: '#f0f2f5', padding: '2px 6px', borderRadius: 4 }}>uv run scrape all</code> from the repo root to generate the data files, then rebuild.
        </p>
      </div>
    )
  }

  const lastUpdated = formatLastUpdated(data.meta)

  return (
    <div className="app">
      <header>
        <h1>New Rochelle Now</h1>
        {lastUpdated && <span className="last-updated">{lastUpdated}</span>}
      </header>

      <nav>
        {TABS.map(t => (
          <button
            key={t.id}
            className={tab === t.id ? 'active' : ''}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {(['map', 'meetings', 'bids', 'news'] as TabId[]).includes(tab) && (
        <div className="date-filter">
          <span>Show from:</span>
          {YEAR_OPTS.map(y => (
            <button
              key={y ?? 'all'}
              className={fromYear === y ? 'selected' : ''}
              onClick={() => setFromYear(y)}
            >
              {y ? `${y}+` : 'All'}
            </button>
          ))}
        </div>
      )}

      <div className="content">
        {tab === 'map' && <MapView construction={data.construction} paving={data.paving} docMap={data.doc_map} fromYear={fromYear} />}
        {tab === 'construction' && <ConstructionView construction={data.construction} />}
        {tab === 'paving' && <PavingView paving={data.paving} />}
        {tab === 'meetings' && <MeetingsView meetings={data.meetings} fromYear={fromYear} />}
        {tab === 'bids' && <BidsView bids={data.bids} fromYear={fromYear} />}
        {tab === 'news' && <NewsView news={data.news} hearings={data.public_hearings} fromYear={fromYear} />}
      </div>
    </div>
  )
}
