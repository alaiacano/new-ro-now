import { useState, useMemo } from 'react'
import type { Meeting } from '../types'

interface Props {
  meetings: Meeting[]
  fromYear: number | null
}

function groupByMonth(events: Meeting[]): Record<string, Meeting[]> {
  const groups: Record<string, Meeting[]> = {}
  for (const ev of events) {
    const d = new Date(ev.start as string)
    const key = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    if (!groups[key]) groups[key] = []
    groups[key].push(ev)
  }
  return groups
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export default function MeetingsView({ meetings, fromYear }: Props) {
  const [calFilter, setCalFilter] = useState<string>('All')

  const dated = useMemo(() => {
    if (!fromYear) return meetings
    const cutoff = new Date(`${fromYear}-01-01`)
    return meetings.filter(m => m.start && new Date(m.start) >= cutoff)
  }, [meetings, fromYear])

  const calendars = useMemo<string[]>(() => {
    const seen = new Set(dated.map(m => m.calendar))
    return ['All', ...Array.from(seen).sort()]
  }, [dated])

  const filtered = calFilter === 'All'
    ? dated
    : dated.filter(m => m.calendar === calFilter)

  const groups = groupByMonth(filtered)

  return (
    <div className="section">
      <div className="section-header">
        <h2>Upcoming Board Meetings</h2>
        <p>Next 6 months · sourced from city iCal feeds</p>
      </div>

      <div className="filter-bar">
        {calendars.map(c => (
          <button
            key={c}
            className={calFilter === c ? 'selected' : ''}
            onClick={() => setCalFilter(c)}
          >
            {c}
          </button>
        ))}
      </div>

      {Object.entries(groups).length === 0 && (
        <div className="empty"><h3>No meetings found</h3></div>
      )}

      {Object.entries(groups).map(([month, events]) => (
        <div key={month} className="meeting-group">
          <div className="meeting-group-label">{month}</div>
          {events.map((ev, i) => (
            <div key={i} className="card">
              <div className="card-meta">
                <span className="tag">{ev.calendar}</span>
                {ev.source === 'document_center'
                  ? <>
                      {ev.classification && <span className="tag">{ev.classification}</span>}
                      {ev.folder && <span style={{ opacity: 0.7 }}>📁 {ev.folder}</span>}
                      <span style={{ opacity: 0.55 }}>📄 Document</span>
                    </>
                  : <span>{formatDate(ev.start as string)} · {formatTime(ev.start as string)}</span>
                }
                {ev.location && <span>📍 {ev.location}</span>}
              </div>
              <div className="card-title">{ev.title}</div>
              {ev.source === 'document_center' && (
                <div style={{ fontSize: '0.8rem', color: ev.relevant_date ? 'var(--text-muted)' : '#b91c1c', marginTop: '0.25rem' }}>
                  Extracted date: {ev.relevant_date ? formatDate(ev.relevant_date) : '⚠ none'}
                </div>
              )}
              {ev.description && (
                <div className="card-body">
                  <p>{ev.description.substring(0, 200)}</p>
                </div>
              )}
              {ev.url && (
                <a className="view-link" href={ev.url} target="_blank" rel="noreferrer">
                  {ev.source === 'document_center' ? 'View document ↗' : 'Agenda & details ↗'}
                </a>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
