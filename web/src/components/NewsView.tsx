import { useState } from 'react'
import type { NewsItem, PublicHearing } from '../types'
import {
  Chips, DocSource, Empty, ExtLink, ViewHeader, YearPicker, type YearOption,
} from './ui'
import { fmtDate } from './format'

interface Props {
  news: NewsItem[]
  hearings: PublicHearing[]
  fromYear: YearOption
  onYear: (y: YearOption) => void
}

type Source = 'all' | 'city' | 'docs'

export default function NewsView({ news, hearings, fromYear, onYear }: Props) {
  const [source, setSource] = useState<Source>('all')
  const cutoff = typeof fromYear === 'number' ? new Date(`${fromYear}-01-01`) : null

  const inYear = news.filter(n => {
    if (!cutoff) return true
    const d = n.published || n.relevant_date
    return d ? new Date(d) >= cutoff : false
  })
  const isDoc = (n: NewsItem) => n.source === 'document_center'
  const shown = inYear.filter(n => source === 'all' || (source === 'docs') === isDoc(n))

  const shownHearings = cutoff
    ? hearings.filter(h => {
        const d = h.date_text ? new Date(h.date_text) : null
        return !d || isNaN(d.getTime()) || d >= cutoff
      })
    : hearings

  return (
    <div className="page">
      <ViewHeader
        title="News and public hearings"
        sub="Press releases, hearing notices and announcements from city documents."
        aside={<YearPicker value={fromYear} onChange={onYear} options={[2026, 2025, 2024, 2023, 2022]} />}
      />

      {shownHearings.length > 0 && (
        <section className="group">
          <h2 className="group-label">Public hearings <span className="count">{shownHearings.length}</span></h2>
          <ul className="rows panel accent-work">
            {shownHearings.map((h, i) => (
              <li key={i} className="row">
                <div className="row-body">
                  {h.date_text && <p className="row-meta"><span>{h.date_text}</span></p>}
                  <p className="row-title">{h.title}</p>
                  {h.url && <p className="row-foot"><ExtLink href={h.url}>Read the notice</ExtLink></p>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="group">
        <div className="group-head">
          <h2 className="group-label">News <span className="count">{shown.length}</span></h2>
          <Chips label="Filter by source" value={source} onChange={setSource} items={[
            { key: 'all', label: 'All' },
            { key: 'city', label: 'Press releases', count: inYear.filter(n => !isDoc(n)).length },
            { key: 'docs', label: 'City documents', count: inYear.filter(isDoc).length },
          ]} />
        </div>

        {shown.length === 0
          ? <Empty title="No news for this period." hint="Try an earlier year." />
          : <ul className="rows panel">
              {shown.map((n, i) => (
                <li key={i} className="row">
                  <div className="row-body">
                    <p className="row-meta">
                      {!isDoc(n) && n.published && <span>{fmtDate(n.published)}</span>}
                      {isDoc(n) && n.relevant_date && <span>{fmtDate(n.relevant_date)}</span>}
                      {n.category && <span className="tag">{n.category}</span>}
                      {isDoc(n) && n.classification && <span className="tag quiet">{n.classification.replace(/_/g, ' ')}</span>}
                    </p>
                    <p className="row-title">{n.title}</p>
                    {n.description && <p className="row-text">{n.description.slice(0, 280)}</p>}
                    <p className="row-foot">
                      {n.url && <ExtLink href={n.url}>{isDoc(n) ? 'Open document' : 'Read more'}</ExtLink>}
                      {isDoc(n) && <DocSource folder={n.folder} date={n.relevant_date} />}
                    </p>
                  </div>
                </li>
              ))}
            </ul>}
      </section>

      {news.length === 0 && hearings.length === 0 && (
        <Empty title="No news yet." hint="Run make news to fetch it." />
      )}
    </div>
  )
}
