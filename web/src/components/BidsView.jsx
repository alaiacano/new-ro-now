export default function BidsView({ bids, fromYear }) {
  const cutoff = fromYear ? new Date(`${fromYear}-01-01`) : null

  function inRange(dateStr) {
    if (!cutoff || !dateStr) return true
    const d = new Date(dateStr)
    return isNaN(d) || d >= cutoff
  }

  const scraped = bids.filter(b => b.source !== 'document_center' && inRange(b.closing_date))
  const open = scraped.filter(b => b.status?.toLowerCase() === 'open')
  const closed = scraped.filter(b => b.status?.toLowerCase() !== 'open')
  const docBids = bids.filter(b => b.source === 'document_center' && inRange(b.status))

  function formatDate(iso) {
    if (!iso) return null
    try {
      return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    } catch { return iso }
  }

  function BidCard({ bid }) {
    const isOpen = bid.status?.toLowerCase() === 'open'
    const isDoc = bid.source === 'document_center'
    return (
      <div className="card">
        <div className="card-meta">
          {bid.bid_number && <span style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>#{bid.bid_number}</span>}
          {!isDoc && <span className={`tag ${isOpen ? 'open' : ''}`}>{bid.status || 'Unknown'}</span>}
          {!isDoc && bid.closing_date && <span>Closes {formatDate(bid.closing_date)}</span>}
          {isDoc && bid.classification && <span className="tag">{bid.classification}</span>}
          {isDoc && bid.folder && <span style={{ opacity: 0.7 }}>📁 {bid.folder}</span>}
          {isDoc && <span style={{ opacity: 0.55 }}>📄 Document</span>}
        </div>
        <div className="card-title">{bid.title}</div>
        {isDoc && (
          <div style={{ fontSize: '0.8rem', color: bid.relevant_date ? 'var(--text-muted)' : '#b91c1c', marginTop: '0.25rem' }}>
            Extracted date: {bid.relevant_date ? formatDate(bid.relevant_date) : '⚠ none'}
          </div>
        )}
        {bid.description && (
          <div className="card-body">
            <p>{bid.description.substring(0, 300)}</p>
          </div>
        )}
        {bid.url && (
          <a className="view-link" href={bid.url} target="_blank" rel="noreferrer">
            {isDoc ? 'View document ↗' : 'Bid documents ↗'}
          </a>
        )}
      </div>
    )
  }

  return (
    <div className="section">
      <div className="section-header">
        <h2>City Bids &amp; Contracts</h2>
        <p>Active procurement opportunities from the city</p>
      </div>

      {open.length > 0 && (
        <>
          <div className="meeting-group-label" style={{ marginBottom: '0.75rem' }}>
            Open ({open.length})
          </div>
          {open.map((bid, i) => <BidCard key={i} bid={bid} />)}
        </>
      )}

      {closed.length > 0 && (
        <div style={{ marginTop: '1.5rem' }}>
          <div className="meeting-group-label" style={{ marginBottom: '0.75rem' }}>
            Closed / Awarded ({closed.length})
          </div>
          {closed.map((bid, i) => <BidCard key={i} bid={bid} />)}
        </div>
      )}

      {docBids.length > 0 && (
        <div style={{ marginTop: '1.5rem' }}>
          <div className="meeting-group-label" style={{ marginBottom: '0.75rem' }}>
            From DocumentCenter ({docBids.length})
          </div>
          {docBids.map((bid, i) => <BidCard key={`doc-${i}`} bid={bid} />)}
        </div>
      )}

      {bids.length === 0 && (
        <div className="empty"><h3>No bids found</h3></div>
      )}
    </div>
  )
}
