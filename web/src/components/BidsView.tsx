import type { Bid } from '../types'
import {
  DocSource, Empty, ExtLink, ViewHeader, YearPicker, type YearOption,
} from './ui'
import { daysUntil, fmtDate } from './format'

interface Props {
  bids: Bid[]
  fromYear: YearOption
  onYear: (y: YearOption) => void
}

function BidRow({ bid }: { bid: Bid }) {
  const isDoc = bid.source === 'document_center'
  const isOpen = bid.status?.toLowerCase() === 'open'
  const days = daysUntil(bid.closing_date)
  const soon = isOpen && days !== null && days >= 0 && days <= 7

  return (
    <li className="row">
      <div className="row-body">
        <p className="row-meta">
          {!isDoc && (
            <span className={`pill${soon ? ' work' : isOpen ? ' sign' : ''}`}>
              {soon ? (days === 0 ? 'Closes today' : `Closes in ${days} day${days === 1 ? '' : 's'}`) : bid.status || 'Status unknown'}
            </span>
          )}
          {!isDoc && bid.closing_date && <span>Closing {fmtDate(bid.closing_date)}</span>}
          {bid.bid_number && <span className="faint">{bid.bid_number}</span>}
          {isDoc && bid.classification && <span className="tag quiet">{bid.classification.replace(/_/g, ' ')}</span>}
        </p>
        <p className="row-title">{bid.title}</p>
        {bid.description && <p className="row-text">{bid.description.slice(0, 300)}</p>}
        <p className="row-foot">
          {bid.url && <ExtLink href={bid.url}>{isDoc ? 'Open document' : 'Bid documents'}</ExtLink>}
          {isDoc && <DocSource folder={bid.folder} date={bid.relevant_date} />}
          {isDoc && bid.relevant_date && <span className="faint">Dated {fmtDate(bid.relevant_date)}</span>}
        </p>
      </div>
    </li>
  )
}

export default function BidsView({ bids, fromYear, onYear }: Props) {
  const cutoff = typeof fromYear === 'number' ? new Date(`${fromYear}-01-01`) : null

  const inRange = (s: string | null | undefined) => {
    if (!cutoff || !s) return true
    const d = new Date(s)
    return isNaN(d.getTime()) || d >= cutoff
  }

  const scraped = bids.filter(b => b.source !== 'document_center' && inRange(b.closing_date))
  const open = scraped
    .filter(b => b.status?.toLowerCase() === 'open')
    .sort((a, b) => (a.closing_date ?? '9').localeCompare(b.closing_date ?? '9'))
  const closed = scraped.filter(b => b.status?.toLowerCase() !== 'open')
  const docBids = bids.filter(b => b.source === 'document_center' && inRange(b.relevant_date))

  const sections: Array<[string, string, Bid[]]> = [
    ['Open for bidding', 'open', open],
    ['Closed or awarded', 'closed', closed],
    ['Bid documents found in city records', 'docs', docBids],
  ]

  return (
    <div className="page">
      <ViewHeader
        title="Bids and contracts"
        sub="Requests for bids and proposals the city has posted, soonest deadline first."
        aside={<YearPicker value={fromYear} onChange={onYear} options={[2026, 2025, 2024, 2023, 2022]} />}
      />

      {bids.length === 0 && <Empty title="No bids yet." hint="Run make bids to fetch them." />}

      {sections.map(([title, key, list]) => list.length > 0 && (
        <section key={key} className="group">
          <h2 className="group-label">{title} <span className="count">{list.length}</span></h2>
          <ul className="rows panel">
            {list.map((b, i) => <BidRow key={`${key}-${i}`} bid={b} />)}
          </ul>
        </section>
      ))}
    </div>
  )
}
