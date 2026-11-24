import { useMemo, useState } from 'react'
import type { Meeting } from '../types'
import {
  Chips, DateStamp, DocSource, Empty, ExtLink, ViewHeader, YearPicker, type YearOption,
} from './ui'
import { fmtDate, fmtTime } from './format'

interface Props {
  meetings: Meeting[]
  fromYear: YearOption
  onYear: (y: YearOption) => void
}

function groupByMonth(events: Meeting[]): Array<[string, Meeting[]]> {
  const groups = new Map<string, Meeting[]>()
  for (const ev of events) {
    const key = new Date(ev.start as string).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(ev)
  }
  return Array.from(groups.entries())
}

export default function MeetingsView({ meetings, fromYear, onYear }: Props) {
  const [cal, setCal] = useState<string>('All')

  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }, [])

  const dated = useMemo(() => {
    const cutoff = fromYear === 'upcoming' || !fromYear ? today : new Date(`${fromYear}-01-01`)
    return meetings.filter(m => m.start && new Date(m.start) >= cutoff)
  }, [meetings, fromYear, today])

  const calendars = useMemo(() => {
    const counts = new Map<string, number>()
    dated.forEach(m => counts.set(m.calendar, (counts.get(m.calendar) ?? 0) + 1))
    return [
      { key: 'All', label: 'All', count: dated.length },
      ...Array.from(counts.entries()).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, count]) => ({ key, label: key, count })),
    ]
  }, [dated])

  const filtered = cal === 'All' ? dated : dated.filter(m => m.calendar === cal)
  const groups = groupByMonth(filtered)

  return (
    <div className="page">
      <ViewHeader
        title="Meetings"
        sub="City board, commission and council meetings from the city calendars and agenda documents."
        aside={<YearPicker value={fromYear} onChange={onYear} />}
      />

      <Chips label="Filter by calendar" items={calendars} value={cal} onChange={setCal} />

      {groups.length === 0 && (
        <Empty title="No meetings match these filters." hint="Pick another calendar, or show an earlier year." />
      )}

      {groups.map(([month, events]) => (
        <section key={month} className="group">
          <h2 className="group-label">{month}</h2>
          <ol className="rows panel">
            {events.map((ev, i) => {
              const isDoc = ev.source === 'document_center'
              const past = new Date(ev.start as string) < today
              return (
                <li key={`${ev.id}-${i}`} className={`row${past ? ' past' : ''}`}>
                  <DateStamp iso={ev.start} />
                  <div className="row-body">
                    <p className="row-meta">
                      {!isDoc && <span>{fmtTime(ev.start as string)}</span>}
                      <span className="tag">{ev.calendar}</span>
                      {isDoc && ev.classification && <span className="tag quiet">{ev.classification.replace(/_/g, ' ')}</span>}
                      {ev.location && <span>{ev.location}</span>}
                    </p>
                    <p className="row-title">{ev.title}</p>
                    {ev.description && <p className="row-text">{ev.description.slice(0, 220)}</p>}
                    <p className="row-foot">
                      {ev.url && <ExtLink href={ev.url}>{isDoc ? 'Open document' : 'Agenda and details'}</ExtLink>}
                      {isDoc && <DocSource folder={ev.folder} date={ev.relevant_date} />}
                      {isDoc && ev.relevant_date && <span className="faint">Dated {fmtDate(ev.relevant_date)}</span>}
                    </p>
                  </div>
                </li>
              )
            })}
          </ol>
        </section>
      ))}
    </div>
  )
}
