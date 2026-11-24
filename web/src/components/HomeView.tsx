import { useMemo } from 'react'
import type { AppData } from '../types'
import {
  DateStamp, ExtLink,
} from './ui'
import { daysUntil, fmtDate, fmtTime } from './format'

const HORIZON_DAYS = 14

function plural(n: number, one: string, many = one + 's') {
  return `${n === 0 ? 'no' : n} ${n === 1 ? one : many}`
}

function closesLabel(days: number | null): string {
  if (days === null) return 'No closing date'
  if (days < 0) return 'Closed'
  if (days === 0) return 'Closes today'
  if (days === 1) return 'Closes tomorrow'
  return `Closes in ${days} days`
}

export default function HomeView({ data }: { data: AppData }) {
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }, [])
  const horizon = new Date(today.getTime() + HORIZON_DAYS * 86_400_000)

  const meetings = data.meetings.filter(m => {
    if (m.source === 'document_center' || !m.start) return false
    const d = new Date(m.start)
    return d >= today && d < horizon
  })

  const openBids = data.bids
    .filter(b => b.source !== 'document_center' && b.status?.toLowerCase() === 'open')
    .sort((a, b) => (a.closing_date ?? '9').localeCompare(b.closing_date ?? '9'))

  const roadwork = data.construction.filter(c => c.source === 'roadway_alerts')
  const flood = data.construction.filter(c => c.source === 'flood_mitigation')

  const monthAgo = new Date(today.getTime() - 30 * 86_400_000)
  const news = data.news
    .filter(n => n.source !== 'document_center' && n.published && new Date(n.published) >= monthAgo)
    .slice(0, 6)
  const hearings = data.public_hearings.slice(0, 4)

  const rangeEnd = new Date(today.getTime() + 6 * 86_400_000)
  const range = `${today.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} to ${
    rangeEnd.toLocaleDateString('en-US', today.getMonth() === rangeEnd.getMonth() ? { day: 'numeric' } : { month: 'long', day: 'numeric' })}`

  const summary = [
    plural(meetings.length, 'public meeting'),
    plural(openBids.length, 'open bid'),
    plural(roadwork.length, 'roadwork alert'),
  ]

  return (
    <div className="page home">
      <header className="home-head">
        <p className="home-kicker">This week in New Rochelle</p>
        <h1 className="home-range">{range}</h1>
        <p className="home-summary">
          {summary[0].replace(/^no/, 'No')} in the next two weeks, {summary[1]}, and {summary[2]} in effect.
        </p>
      </header>

      <div className="home-grid">
        <section className="panel" aria-labelledby="h-meetings">
          <div className="panel-head">
            <h2 id="h-meetings">Coming up</h2>
            <a href="#meetings">All meetings</a>
          </div>
          {meetings.length === 0
            ? <p className="panel-empty">No public meetings on the city calendars for the next two weeks.</p>
            : <ol className="rows">
                {meetings.slice(0, 8).map(m => (
                  <li key={m.id} className="row">
                    <DateStamp iso={m.start} />
                    <div className="row-body">
                      <p className="row-meta">
                        <span>{fmtTime(m.start as string)}</span>
                        <span className="tag">{m.calendar}</span>
                      </p>
                      <p className="row-title">{m.title}</p>
                      {m.url && <ExtLink href={m.url}>Agenda and details</ExtLink>}
                    </div>
                  </li>
                ))}
              </ol>}
          {meetings.length > 8 && (
            <p className="panel-more"><a href="#meetings">{meetings.length - 8} more in the next two weeks</a></p>
          )}
        </section>

        <div className="home-side">
          <section className="panel" aria-labelledby="h-bids">
            <div className="panel-head">
              <h2 id="h-bids">Bids open now</h2>
              <a href="#bids">All bids</a>
            </div>
            {openBids.length === 0
              ? <p className="panel-empty">The city has no open bids right now.</p>
              : <ul className="rows compact">
                  {openBids.map((b, i) => {
                    const days = daysUntil(b.closing_date)
                    const soon = days !== null && days <= 7
                    return (
                      <li key={b.bid_number ?? i} className="row">
                        <div className="row-body">
                          <p className="row-title">{b.title}</p>
                          <p className="row-meta">
                            <span className={soon ? 'pill work' : 'pill'}>{closesLabel(days)}</span>
                            {b.closing_date && <span>{fmtDate(b.closing_date, false)}</span>}
                          </p>
                          {b.url && <ExtLink href={b.url}>Bid documents</ExtLink>}
                        </div>
                      </li>
                    )
                  })}
                </ul>}
          </section>

          <section className="panel" aria-labelledby="h-work">
            <div className="panel-head">
              <h2 id="h-work">Roadwork and flood projects</h2>
              <a href="#map">Map</a>
            </div>
            <div className="tally">
              <a className="tally-cell work" href="#construction">
                <span className="tally-n">{roadwork.length}</span>
                <span>roadway alerts</span>
              </a>
              <a className="tally-cell water" href="#construction">
                <span className="tally-n">{flood.length}</span>
                <span>flood and stormwater projects</span>
              </a>
            </div>
            {roadwork.length > 0 && (
              <ul className="rows compact">
                {roadwork.slice(0, 4).map((r, i) => (
                  <li key={i} className="row">
                    <div className="row-body">
                      <p className="row-title">{r.title}</p>
                      {r.addresses && r.addresses.length > 0 && (
                        <p className="row-meta"><span>{r.addresses.slice(0, 2).join('; ')}</span></p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section className="panel home-news" aria-labelledby="h-news">
          <div className="panel-head">
            <h2 id="h-news">From the city</h2>
            <a href="#news">All news</a>
          </div>
          {news.length === 0 && hearings.length === 0
            ? <p className="panel-empty">Nothing new from the city in the last 30 days.</p>
            : <ul className="rows">
                {hearings.map((h, i) => (
                  <li key={`h${i}`} className="row">
                    <div className="row-body">
                      <p className="row-meta">
                        <span className="tag work">Public hearing</span>
                        {h.date_text && <span>{h.date_text}</span>}
                      </p>
                      <p className="row-title">
                        {h.url ? <a href={h.url} target="_blank" rel="noreferrer">{h.title}</a> : h.title}
                      </p>
                    </div>
                  </li>
                ))}
                {news.map((n, i) => (
                  <li key={`n${i}`} className="row">
                    <div className="row-body">
                      <p className="row-meta">
                        <span>{fmtDate(n.published, false)}</span>
                        {n.category && <span className="tag">{n.category}</span>}
                      </p>
                      <p className="row-title">
                        {n.url ? <a href={n.url} target="_blank" rel="noreferrer">{n.title}</a> : n.title}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>}
        </section>
      </div>
    </div>
  )
}
