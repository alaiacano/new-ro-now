export default function BidsView({ bids }) {
  const open = bids.filter(b => b.status?.toLowerCase() === 'open')
  const closed = bids.filter(b => b.status?.toLowerCase() !== 'open')

  function formatDate(iso) {
    if (!iso) return null
    try {
      return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    } catch { return iso }
  }

  function BidCard({ bid }) {
    const isOpen = bid.status?.toLowerCase() === 'open'
    return (
      <div className="card">
        <div className="card-meta">
          {bid.bid_number && <span style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>#{bid.bid_number}</span>}
          <span className={`tag ${isOpen ? 'open' : ''}`}>{bid.status || 'Unknown'}</span>
          {bid.closing_date && (
            <span>Closes {formatDate(bid.closing_date)}</span>
          )}
        </div>
        <div className="card-title">{bid.title}</div>
        {bid.description && (
          <div className="card-body">
            <p>{bid.description.substring(0, 300)}</p>
          </div>
        )}
        {bid.url && (
          <a className="view-link" href={bid.url} target="_blank" rel="noreferrer">
            Bid documents ↗
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

      {bids.length === 0 && (
        <div className="empty"><h3>No bids found</h3></div>
      )}
    </div>
  )
}
