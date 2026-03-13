import { useState, useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Tooltip } from 'react-leaflet'
import MarkerClusterGroup from 'react-leaflet-cluster'
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

// Colors for document classifications — cycles if more classes than entries
const DOC_CLASS_COLORS = [
  '#9333ea', '#0891b2', '#b45309', '#be185d',
  '#15803d', '#1d4ed8', '#c2410c', '#6d28d9',
  '#0f766e', '#b91c1c', '#1e40af', '#92400e',
]

function pavingColor(yearIndex) {
  return PAVING_COLORS[yearIndex % PAVING_COLORS.length]
}

function docClassColor(index) {
  return DOC_CLASS_COLORS[index % DOC_CLASS_COLORS.length]
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

export default function MapView({ construction, paving, docMap = [], fromYear }) {
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
    return Object.entries(map)
      .sort(([a], [b]) => String(b).localeCompare(String(a)))
      .map(([year, streetMap], idx) => ({
        year,
        entries: Array.from(streetMap.values()),
        color: pavingColor(idx),
        layerId: `paving_${year}`,
      }))
  }, [paving])

  const MAP_EXCLUDED_CLASSIFICATIONS = new Set([
    'press_release', 'agenda', 'public_hearing', 'specification',
  ])

  // Filter doc_map by year and excluded classifications, then group by classification
  const docByClassification = useMemo(() => {
    const cutoff = fromYear ? new Date(`${fromYear}-01-01`) : null
    const filtered = docMap.filter(d => {
      if (MAP_EXCLUDED_CLASSIFICATIONS.has(d.classification)) return false
      if (!cutoff) return true
      if (!d.relevant_date) return false
      const dt = new Date(d.relevant_date)
      return !isNaN(dt) && dt >= cutoff
    })

    const groups = {}
    filtered.forEach(doc => {
      const cls = doc.classification || 'other'
      if (!groups[cls]) groups[cls] = []
      groups[cls].push(doc)
    })

    return Object.entries(groups)
      .sort(([, a], [, b]) => b.length - a.length)
      .map(([cls, docs], idx) => ({
        cls,
        docs,
        color: docClassColor(idx),
        layerId: `doc_${cls}`,
        label: cls.replace(/_/g, ' '),
      }))
  }, [docMap, fromYear])

  const center = [40.9115, -73.7824]

  return (
    <div className="map-layout">
      <div className="map-pane">
        <MapContainer center={center} zoom={13} style={{ height: '100%', width: '100%' }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <MarkerClusterGroup chunkedLoading>
          {!hiddenLayers.has('roadway_alerts') && mappedConstruction
            .filter(p => p.source === 'roadway_alerts')
            .map((proj, i) => (
              <Marker key={`road-${i}`} position={[proj.coords.lat, proj.coords.lng]}
                icon={coloredIcon(COLORS.roadway_alerts)}
                eventHandlers={{ click: () => setSelected({ ...proj, _type: 'construction' }) }}>
                <Tooltip direction="top" offset={[0, -6]}>
                  <strong>{proj.title}</strong><br />
                  <span style={{ fontSize: '0.8em', color: '#555' }}>Roadway Alert</span>
                </Tooltip>
              </Marker>
            ))}

          {!hiddenLayers.has('flood_mitigation') && mappedConstruction
            .filter(p => p.source === 'flood_mitigation')
            .map((proj, i) => (
              <Marker key={`flood-${i}`} position={[proj.coords.lat, proj.coords.lng]}
                icon={coloredIcon(COLORS.flood_mitigation)}
                eventHandlers={{ click: () => setSelected({ ...proj, _type: 'construction' }) }}>
                <Tooltip direction="top" offset={[0, -6]}>
                  <strong>{proj.title}</strong><br />
                  <span style={{ fontSize: '0.8em', color: '#555' }}>Flood/Stormwater</span>
                </Tooltip>
              </Marker>
            ))}

          {docByClassification.map(({ cls, docs, color, layerId }) =>
            !hiddenLayers.has(layerId) && docs.map((doc, i) => (
              <Marker key={`doc-${cls}-${i}`} position={[doc.coords.lat, doc.coords.lng]}
                icon={coloredIcon(color, 12)}
                eventHandlers={{ click: () => setSelected({ ...doc, _type: 'document' }) }}>
                <Tooltip direction="top" offset={[0, -6]}>
                  <strong>{doc.title}</strong><br />
                  <span style={{ fontSize: '0.8em', color: '#555' }}>{doc.classification}</span>
                  {doc.relevant_date && <><br /><span style={{ fontSize: '0.8em', color: '#888' }}>{doc.relevant_date}</span></>}
                </Tooltip>
              </Marker>
            ))
          )}

          {pavingByYear.map(({ year, entries, color, layerId }) =>
            !hiddenLayers.has(layerId) && entries.map((entry, i) => (
              <Marker key={`pave-${year}-${i}`} position={[entry.coords.lat, entry.coords.lng]}
                icon={coloredIcon(color, 12)}
                eventHandlers={{ click: () => setSelected({ ...entry, _type: 'paving' }) }}>
                <Tooltip direction="top" offset={[0, -6]}>
                  <strong>{entry.street}</strong><br />
                  <span style={{ fontSize: '0.8em', color: '#555' }}>
                    {year} Paving · {entry.list}
                    {entry.to && entry.from && <> · {entry.to} → {entry.from}</>}
                  </span>
                </Tooltip>
              </Marker>
            ))
          )}
          </MarkerClusterGroup>
        </MapContainer>
      </div>

      <div className="map-sidebar">
        {/* Layer toggles */}
        <div style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.6rem' }}>
            <button onClick={() => setHiddenLayers(new Set())}
              style={{ flex: 1, fontSize: '0.75rem', padding: '0.2rem 0', border: '1px solid var(--border)',
                       borderRadius: 4, background: 'var(--surface)', cursor: 'pointer', color: 'var(--text-muted)' }}>
              Show all
            </button>
            <button onClick={() => setHiddenLayers(new Set([
              ...CONSTRUCTION_LAYERS.map(l => l.id),
              ...docByClassification.map(d => d.layerId),
              ...pavingByYear.map(p => p.layerId),
            ]))}
              style={{ flex: 1, fontSize: '0.75rem', padding: '0.2rem 0', border: '1px solid var(--border)',
                       borderRadius: 4, background: 'var(--surface)', cursor: 'pointer', color: 'var(--text-muted)' }}>
              Hide all
            </button>
          </div>

          {CONSTRUCTION_LAYERS.map(layer => (
            <LayerToggle key={layer.id}
              layerId={layer.id}
              label={layer.label}
              color={COLORS[layer.id]}
              count={mappedConstruction.filter(p => p.source === layer.id).length}
              hidden={hiddenLayers.has(layer.id)}
              onToggle={toggleLayer}
            />
          ))}

          {docByClassification.length > 0 && (
            <div style={{ marginTop: '0.5rem', marginBottom: '0.25rem', fontSize: '0.72rem',
                          fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
                          color: 'var(--text-muted)' }}>
              Documents
            </div>
          )}
          {docByClassification.map(({ cls, docs, color, layerId, label }) => (
            <LayerToggle key={layerId}
              layerId={layerId}
              label={`📄 ${label}`}
              color={color}
              count={docs.length}
              hidden={hiddenLayers.has(layerId)}
              onToggle={toggleLayer}
            />
          ))}

          {pavingByYear.map(({ year, entries, color, layerId }) => (
            <LayerToggle key={layerId}
              layerId={layerId}
              label={`🛣 Paving ${year}`}
              color={color}
              count={entries.length}
              hidden={hiddenLayers.has(layerId)}
              onToggle={toggleLayer}
            />
          ))}
        </div>

        {/* Active item detail panel */}
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
            {selected._type === 'document' && selected.description && (
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                {selected.description.substring(0, 120)}…
              </div>
            )}
            {(selected._type === 'construction' || selected._type === 'document') && selected.url && (
              <a href={selected.url} target="_blank" rel="noreferrer" style={{ fontSize: '0.78rem' }}>
                {selected._type === 'document' ? 'View document ↗' : 'Details ↗'}
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

function LayerToggle({ layerId, label, color, count, hidden, onToggle }) {
  return (
    <label style={{
      display: 'flex', alignItems: 'center', gap: '0.5rem',
      fontSize: '0.82rem', cursor: 'pointer', marginBottom: '0.35rem',
      opacity: hidden ? 0.45 : 1,
    }}>
      <span style={{
        width: 12, height: 12, borderRadius: '50%',
        background: color, display: 'inline-block', flexShrink: 0,
      }} />
      <input type="checkbox" checked={!hidden} onChange={() => onToggle(layerId)} style={{ display: 'none' }} />
      {label}
      <span style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>{count}</span>
    </label>
  )
}
