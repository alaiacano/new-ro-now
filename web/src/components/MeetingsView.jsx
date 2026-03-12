import { useState, useMemo } from 'react'

function groupByMonth(events) {
  const groups = {}
  for (const ev of events) {
    const d = new Date(ev.start)
    const key = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    if (!groups[key]) groups[key] = []
    groups[key].push(ev)
  }
  return groups
}

function formatDate(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function formatTime(iso) {
  const d = new Date(iso)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

const ALL_CALENDARS = [
  'Planning Board', 'Zoning Board', 'City Clerk',
  'Historical & Landmark Review Board', 'Municipal Arts Commission',
  'IDA', 'Housing', 'Finance', 'Youth Bureau', 'Parks and Recreation',
]

export default function MeetingsView({ meetings }) {
  const [calFilter, setCalFilter] = useState('All')

  const calendars = useMemo(() => {
    const seen = new Set(meetings.map(m => m.calendar))
    return ['All', ...Array.from(seen).sort()]
  }, [meetings])

  const filtered = calFilter === 'All'
    ? meetings
    : meetings.filter(m => m.calendar === calFilter)

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
                <span>{formatDate(ev.start)} · {formatTime(ev.start)}</span>
                {ev.location && <span>📍 {ev.location}</span>}
              </div>
              <div className="card-title">{ev.title}</div>
              {ev.description && (
                <div className="card-body">
                  <p>{ev.description.substring(0, 200)}</p>
                </div>
              )}
              {ev.url && (
                <a className="view-link" href={ev.url} target="_blank" rel="noreferrer">
                  Agenda & details ↗
                </a>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
