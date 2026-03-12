function formatDate(iso) {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return iso }
}

export default function NewsView({ news, hearings }) {
  return (
    <div className="section">
      <div className="section-header">
        <h2>City News &amp; Public Hearings</h2>
        <p>Press releases and recent public hearing notices</p>
      </div>

      {hearings.length > 0 && (
        <div style={{ marginBottom: '2rem' }}>
          <div className="meeting-group-label" style={{ marginBottom: '0.75rem' }}>
            Public Hearings (last 12 months)
          </div>
          {hearings.map((h, i) => (
            <div key={i} className="card">
              <div className="card-meta">
                <span className="tag">Public Hearing</span>
                {h.date_text && <span>{h.date_text}</span>}
              </div>
              <div className="card-title">{h.title}</div>
              {h.url && (
                <a className="view-link" href={h.url} target="_blank" rel="noreferrer">
                  View notice ↗
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="meeting-group-label" style={{ marginBottom: '0.75rem' }}>
        Latest News ({news.length})
      </div>
      {news.map((item, i) => (
        <div key={i} className="card">
          <div className="card-meta">
            {item.category && <span className="tag">{item.category}</span>}
            {item.published && <span>{formatDate(item.published)}</span>}
          </div>
          <div className="card-title">{item.title}</div>
          {item.description && (
            <div className="card-body"><p>{item.description}</p></div>
          )}
          {item.url && (
            <a className="view-link" href={item.url} target="_blank" rel="noreferrer">
              Read more ↗
            </a>
          )}
        </div>
      ))}

      {news.length === 0 && hearings.length === 0 && (
        <div className="empty"><h3>No news found</h3></div>
      )}
    </div>
  )
}
