function formatDate(iso) {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return iso }
}

export default function NewsView({ news, hearings, fromYear }) {
  const cutoff = fromYear ? new Date(`${fromYear}-01-01`) : null

  const filteredNews = cutoff
    ? news.filter(item => item.published && new Date(item.published) >= cutoff)
    : news

  const filteredHearings = cutoff
    ? hearings.filter(h => {
        const d = h.date_text ? new Date(h.date_text) : null
        return !d || isNaN(d) || d >= cutoff
      })
    : hearings

  return (
    <div className="section">
      <div className="section-header">
        <h2>City News &amp; Public Hearings</h2>
        <p>Press releases and recent public hearing notices</p>
      </div>

      {filteredHearings.length > 0 && (
        <div style={{ marginBottom: '2rem' }}>
          <div className="meeting-group-label" style={{ marginBottom: '0.75rem' }}>
            Public Hearings (last 12 months)
          </div>
          {filteredHearings.map((h, i) => (
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
        Latest News ({filteredNews.length})
      </div>
      {filteredNews.map((item, i) => {
        const isDoc = item.source === 'document_center'
        return (
          <div key={i} className="card">
            <div className="card-meta">
              {item.category && <span className="tag">{item.category}</span>}
              {item.folder && isDoc && <span style={{ opacity: 0.7 }}>📁 {item.folder}</span>}
              {isDoc && <span style={{ opacity: 0.55 }}>📄 Document</span>}
              {!isDoc && item.published && <span>{formatDate(item.published)}</span>}
            </div>
            <div className="card-title">{item.title}</div>
            {isDoc && (
              <div style={{ fontSize: '0.8rem', color: item.relevant_date ? 'var(--text-muted)' : '#b91c1c', marginTop: '0.25rem' }}>
                Extracted date: {item.relevant_date ? formatDate(item.relevant_date) : '⚠ none'}
              </div>
            )}
            {item.description && (
              <div className="card-body"><p>{item.description}</p></div>
            )}
            {item.url && (
              <a className="view-link" href={item.url} target="_blank" rel="noreferrer">
                {isDoc ? 'View document ↗' : 'Read more ↗'}
              </a>
            )}
          </div>
        )
      })}

      {filteredNews.length === 0 && filteredHearings.length === 0 && (
        <div className="empty"><h3>No news found</h3></div>
      )}
    </div>
  )
}
