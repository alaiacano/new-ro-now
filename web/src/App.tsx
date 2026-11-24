import { useEffect, useState } from 'react'
import {
  CalendarRange, Map as MapIcon, Construction, Route, Landmark, ClipboardList, Megaphone,
  type LucideIcon,
} from 'lucide-react'
import './App.css'
import { useData } from './useData'
import type { Meta } from './types'
import type { YearOption } from './components/ui'
import HomeView from './components/HomeView'
import MapView from './components/MapView'
import MeetingsView from './components/MeetingsView'
import ConstructionView from './components/ConstructionView'
import PavingView from './components/PavingView'
import BidsView from './components/BidsView'
import NewsView from './components/NewsView'

export type TabId = 'week' | 'map' | 'construction' | 'paving' | 'meetings' | 'bids' | 'news'

const TABS: Array<{ id: TabId; label: string; icon: LucideIcon }> = [
  { id: 'week',         label: 'This week', icon: CalendarRange },
  { id: 'map',          label: 'Map',       icon: MapIcon },
  { id: 'construction', label: 'Projects',  icon: Construction },
  { id: 'paving',       label: 'Paving',    icon: Route },
  { id: 'meetings',     label: 'Meetings',  icon: Landmark },
  { id: 'bids',         label: 'Bids',      icon: ClipboardList },
  { id: 'news',         label: 'News',      icon: Megaphone },
]

function tabFromHash(): TabId {
  const h = window.location.hash.replace(/^#\/?/, '')
  return (TABS.some(t => t.id === h) ? h : 'week') as TabId
}

function lastUpdated(meta: Meta): string | null {
  const dates = Object.values(meta).filter((v): v is string => Boolean(v))
  if (!dates.length) return null
  const d = new Date(dates.sort().at(-1) as string)
  if (isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function Wordmark() {
  return (
    <a className="wordmark" href="#week" aria-label="New Rochelle Now, this week">
      <span className="blade">
        <span className="blade-name">New Rochelle</span>
        <span className="blade-suffix">Now</span>
      </span>
    </a>
  )
}

export default function App() {
  const [tab, setTab] = useState<TabId>(tabFromHash)
  const [years, setYears] = useState<Record<string, YearOption>>({
    map: 2026, bids: 2026, news: 2026, meetings: 'upcoming',
  })
  const { data, loading, error } = useData()

  useEffect(() => {
    const onHash = () => setTab(tabFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    document.querySelector('.content')?.scrollTo(0, 0)
  }, [tab])

  const yearFor = (id: TabId) => years[id] ?? 2026
  const setYearFor = (id: TabId) => (y: YearOption) => setYears(prev => ({ ...prev, [id]: y }))
  const updated = lastUpdated(data.meta)

  let body
  if (loading) {
    body = <div className="status">Loading city data…</div>
  } else if (error) {
    body = (
      <div className="status">
        <p className="status-title">The data files didn&rsquo;t load.</p>
        <p>{error}</p>
        <p>Run <code>make quick</code> from the repo root to generate them, then reload.</p>
      </div>
    )
  } else {
    body = (
      <>
        {tab === 'week' && <HomeView data={data} />}
        {tab === 'map' && <MapView construction={data.construction} paving={data.paving} docMap={data.doc_map}
                                   fromYear={yearFor('map')} onYear={setYearFor('map')} />}
        {tab === 'construction' && <ConstructionView construction={data.construction} />}
        {tab === 'paving' && <PavingView paving={data.paving} />}
        {tab === 'meetings' && <MeetingsView meetings={data.meetings}
                                             fromYear={yearFor('meetings')} onYear={setYearFor('meetings')} />}
        {tab === 'bids' && <BidsView bids={data.bids} fromYear={yearFor('bids')} onYear={setYearFor('bids')} />}
        {tab === 'news' && <NewsView news={data.news} hearings={data.public_hearings}
                                     fromYear={yearFor('news')} onYear={setYearFor('news')} />}
      </>
    )
  }

  return (
    <div className="app">
      <div className="topbar">
        <Wordmark />
        <nav aria-label="Sections">
          {TABS.map(({ id, label, icon: Icon }) => (
            <a key={id} href={`#${id}`} className="tab" aria-current={tab === id ? 'page' : undefined}>
              <Icon size={16} strokeWidth={2} aria-hidden="true" />
              <span>{label}</span>
            </a>
          ))}
        </nav>
        {updated && <span className="updated">Updated {updated}</span>}
      </div>
      <main className={`content${tab === 'map' ? ' content-map' : ''}`}>{body}</main>
    </div>
  )
}
