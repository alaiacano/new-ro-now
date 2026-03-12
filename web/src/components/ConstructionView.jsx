import { useState } from 'react'

export default function ConstructionView({ construction }) {
  const [filter, setFilter] = useState('all')

  const filtered = filter === 'all'
    ? construction
    : construction.filter(p => p.source === filter)

  return (
    <div className="section">
      <div className="section-header">
        <h2>Construction &amp; Infrastructure Projects</h2>
        <p>Active roadway alerts and flood/stormwater work · <a href="/?tab=map">View on map ↗</a></p>
      </div>

      <div className="filter-bar">
        {[
          { key: 'all', label: 'All' },
          { key: 'roadway_alerts', label: '🚧 Roadway' },
          { key: 'flood_mitigation', label: '💧 Flood/Stormwater' },
        ].map(f => (
          <button
            key={f.key}
            className={filter === f.key ? 'selected' : ''}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="empty"><h3>No projects found</h3></div>
      )}

      {filtered.map((proj, i) => (
        <div key={i} className="card">
          <div className="card-meta">
            <span className={`tag ${proj.source === 'roadway_alerts' ? 'roadway' : 'flood'}`}>
              {proj.source === 'roadway_alerts' ? '🚧 Roadway' : '💧 Flood/Stormwater'}
            </span>
            {proj.project_id && <span>#{proj.project_id}</span>}
            {proj.coords
              ? <span style={{ color: '#16a34a' }}>📍 Mapped</span>
              : <span style={{ color: '#9ca3af' }}>📍 Location pending</span>
            }
          </div>
          <div className="card-title">{proj.title}</div>
          {proj.addresses?.length > 0 && (
            <div className="card-body">
              <p>{proj.addresses.join(' · ')}</p>
            </div>
          )}
          {proj.description && (
            <div className="card-body">
              <p>{proj.description.substring(0, 300)}{proj.description.length > 300 ? '…' : ''}</p>
            </div>
          )}
          {proj.url && proj.url !== 'https://www.newrochelleny.gov/1831/Flood-Mitigation-Projects' && (
            <a className="view-link" href={proj.url} target="_blank" rel="noreferrer">
              Project details ↗
            </a>
          )}
        </div>
      ))}
    </div>
  )
}
