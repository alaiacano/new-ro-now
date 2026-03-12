import { useState, useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Fix Leaflet default marker icon path issue with bundlers
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const COLORS = {
  roadway_alerts:   '#d97706',
  flood_mitigation: '#2563eb',
}

// Distinct colors per paving year (cycles if more than palette length)
const PAVING_COLORS = ['#16a34a', '#0d9488', '#7c3aed', '#db2777', '#ea580c']

function pavingColor(yearIndex) {
  return PAVING_COLORS[yearIndex % PAVING_COLORS.length]
}

function coloredIcon(color, size = 14) {
  return L.divIcon({
    className: '',
    html: `<div style="
      width:${size}px;height:${size}px;
      background:${color};
      border:2px solid #fff;
      border-radius:50%;
      box-shadow:0 1px 4px rgba(0,0,0,0.4);
    "></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

const CONSTRUCTION_LAYERS = [
  { id: 'roadway_alerts',   label: '🚧 Roadway' },
  { id: 'flood_mitigation', label: '💧 Flood/Storm' },
]

export default function MapView({ construction, paving }) {
  const [selected, setSelected] = useState(null)
  const [hiddenLayers, setHiddenLayers] = useState(new Set())

  function toggleLayer(id) {
    setHiddenLayers(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const mappedConstruction = construction.filter(p => p.coords)
  const unmappedConstruction = construction.filter(p => !p.coords)

  // Group paving by year; deduplicate by street name within each year
  const pavingByYear = useMemo(() => {
    const map = {}
    paving.forEach(p => {
      if (!p.coords) return
      const yr = p.year ?? 'Unknown'
      if (!map[yr]) map[yr] = new Map()
      if (!map[yr].has(p.street)) map[yr].set(p.street, p)
    })
    // Convert Maps to arrays, sorted by year descending
    return Object.entries(map)
      .sort(([a], [b]) => String(b).localeCompare(String(a)))
      .map(([year, streetMap], idx) => ({
        year,
        entries: Array.from(streetMap.values()),
        color: pavingColor(idx),
        layerId: `paving_${year}`,
      }))
  }, [paving])

  const center = [40.9115, -73.7824]

  return (
    <div className="map-layout">
      <div className="map-pane">
        <MapContainer center={center} zoom={13} style={{ height: '100%', width: '100%' }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {!hiddenLayers.has('roadway_alerts') && mappedConstruction
            .filter(p => p.source === 'roadway_alerts')
            .map((proj, i) => (
              <Marker key={`road-${i}`} position={[proj.coords.lat, proj.coords.lng]}
                icon={coloredIcon(COLORS.roadway_alerts)}
                eventHandlers={{ click: () => setSelected({ ...proj, _type: 'construction' }) }}>
                <Popup>
                  <strong>{proj.title}</strong><br />
                  <span style={{ fontSize: '0.8em', color: '#555' }}>Roadway Alert</span>
                  {proj.url && <><br /><a href={proj.url} target="_blank" rel="noreferrer" style={{ fontSize: '0.8em' }}>More info ↗</a></>}
                </Popup>
              </Marker>
            ))}

          {!hiddenLayers.has('flood_mitigation') && mappedConstruction
            .filter(p => p.source === 'flood_mitigation')
            .map((proj, i) => (
              <Marker key={`flood-${i}`} position={[proj.coords.lat, proj.coords.lng]}
                icon={coloredIcon(COLORS.flood_mitigation)}
                eventHandlers={{ click: () => setSelected({ ...proj, _type: 'construction' }) }}>
                <Popup>
                  <strong>{proj.title}</strong><br />
                  <span style={{ fontSize: '0.8em', color: '#555' }}>Flood/Stormwater</span>
                  {proj.url && <><br /><a href={proj.url} target="_blank" rel="noreferrer" style={{ fontSize: '0.8em' }}>More info ↗</a></>}
                </Popup>
              </Marker>
            ))}

          {pavingByYear.map(({ year, entries, color, layerId }) =>
            !hiddenLayers.has(layerId) && entries.map((entry, i) => (
              <Marker key={`pave-${year}-${i}`} position={[entry.coords.lat, entry.coords.lng]}
                icon={coloredIcon(color, 12)}
                eventHandlers={{ click: () => setSelected({ ...entry, _type: 'paving' }) }}>
                <Popup>
                  <strong>{entry.street}</strong><br />
                  <span style={{ fontSize: '0.8em', color: '#555' }}>
                    {year} Paving · {entry.list}
                    {entry.to && entry.from && <><br />{entry.to} → {entry.from}</>}
                  </span>
                </Popup>
              </Marker>
            ))
          )}
        </MapContainer>
      </div>

      <div className="map-sidebar">
        {/* Layer toggles */}
        <div style={{ marginBottom: '1rem' }}>
          {CONSTRUCTION_LAYERS.map(layer => (
            <label key={layer.id} style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem',
              fontSize: '0.82rem', cursor: 'pointer', marginBottom: '0.35rem',
              opacity: hiddenLayers.has(layer.id) ? 0.45 : 1,
            }}>
              <span style={{
                width: 12, height: 12, borderRadius: '50%',
                background: COLORS[layer.id], display: 'inline-block', flexShrink: 0,
              }} />
              <input type="checkbox" checked={!hiddenLayers.has(layer.id)}
                onChange={() => toggleLayer(layer.id)}
                style={{ display: 'none' }} />
              {layer.label}
              <span style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>
                {mappedConstruction.filter(p => p.source === layer.id).length}
              </span>
            </label>
          ))}

          {pavingByYear.map(({ year, entries, color, layerId }) => (
            <label key={layerId} style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem',
              fontSize: '0.82rem', cursor: 'pointer', marginBottom: '0.35rem',
              opacity: hiddenLayers.has(layerId) ? 0.45 : 1,
            }}>
              <span style={{
                width: 12, height: 12, borderRadius: '50%',
                background: color, display: 'inline-block', flexShrink: 0,
              }} />
              <input type="checkbox" checked={!hiddenLayers.has(layerId)}
                onChange={() => toggleLayer(layerId)}
                style={{ display: 'none' }} />
              🛣 Paving {year}
              <span style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>
                {entries.length}
              </span>
            </label>
          ))}
        </div>

        {/* Active project details when selected */}
        {selected && (
          <div style={{ marginBottom: '1rem', padding: '0.75rem', background: 'var(--brand-light)', borderRadius: 8 }}>
            <div style={{ fontSize: '0.88rem', fontWeight: 600, marginBottom: '0.25rem' }}>
              {selected._type === 'paving' ? selected.street : selected.title}
            </div>
            {selected._type === 'paving' && selected.to && (
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                {selected.to} → {selected.from}
              </div>
            )}
            {selected._type === 'construction' && selected.url && (
              <a href={selected.url} target="_blank" rel="noreferrer" style={{ fontSize: '0.78rem' }}>
                Details ↗
              </a>
            )}
            <button onClick={() => setSelected(null)} style={{
              float: 'right', background: 'none', border: 'none',
              fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '-1.25rem',
            }}>✕</button>
          </div>
        )}

        {/* Construction list */}
        <h3>Active projects ({mappedConstruction.length})</h3>
        {mappedConstruction.map((proj, i) => (
          <div key={i} className="map-item"
            onClick={() => setSelected({ ...proj, _type: 'construction' })}
            style={selected === proj ? { background: 'var(--brand-light)' } : {}}>
            <div className="map-item-title">{proj.title}</div>
            <div className="map-item-sub">
              {proj.source === 'roadway_alerts' ? '🚧 Roadway' : '💧 Flood/Storm'}
              {proj.url && <> · <a href={proj.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>details ↗</a></>}
            </div>
          </div>
        ))}

        {unmappedConstruction.length > 0 && (
          <>
            <h3 style={{ marginTop: '1rem' }}>Not yet mapped ({unmappedConstruction.length})</h3>
            {unmappedConstruction.map((proj, i) => (
              <div key={i} className="map-item" style={{ opacity: 0.55 }}>
                <div className="map-item-title">{proj.title}</div>
                {proj.url && <div className="map-item-sub"><a href={proj.url} target="_blank" rel="noreferrer">details ↗</a></div>}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
