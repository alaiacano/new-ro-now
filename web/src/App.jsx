import { useState } from 'react'
import './App.css'
import { useData } from './useData'
import MapView from './components/MapView'
import MeetingsView from './components/MeetingsView'
import ConstructionView from './components/ConstructionView'
import PavingView from './components/PavingView'
import BidsView from './components/BidsView'
import NewsView from './components/NewsView'

const TABS = [
  { id: 'map',          label: '🗺 Map' },
  { id: 'construction', label: '🚧 Projects' },
  { id: 'paving',       label: '🛣 Paving' },
  { id: 'meetings',     label: '📅 Meetings' },
  { id: 'bids',         label: '📋 Bids' },
  { id: 'news',         label: '📰 News' },
]

function formatLastUpdated(meta) {
  const dates = Object.values(meta).filter(Boolean)
  if (!dates.length) return null
  const latest = dates.sort().at(-1)
  try {
    return 'Updated ' + new Date(latest).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })
  } catch { return null }
}

export default function App() {
  const [tab, setTab] = useState('map')
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

      <div className="content">
        {tab === 'map' && <MapView construction={data.construction} paving={data.paving} />}
        {tab === 'construction' && <ConstructionView construction={data.construction} />}
        {tab === 'paving' && <PavingView paving={data.paving} />}
        {tab === 'meetings' && <MeetingsView meetings={data.meetings} />}
        {tab === 'bids' && <BidsView bids={data.bids} />}
        {tab === 'news' && <NewsView news={data.news} hearings={data.public_hearings} />}
      </div>
    </div>
  )
}
