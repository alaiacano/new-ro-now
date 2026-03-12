import { useState, useEffect } from 'react'
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

const SOURCE_COLORS = {
  roadway_alerts: '#d97706',
  flood_mitigation: '#2563eb',
}

function coloredIcon(color) {
  return L.divIcon({
    className: '',
    html: `<div style="
      width:14px;height:14px;
      background:${color};
      border:2px solid #fff;
      border-radius:50%;
      box-shadow:0 1px 4px rgba(0,0,0,0.4);
    "></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  })
}

export default function MapView({ construction }) {
  const [selected, setSelected] = useState(null)
  const mapped = construction.filter(p => p.coords)
  const unmapped = construction.filter(p => !p.coords)

  const center = [40.9115, -73.7824] // New Rochelle center

  return (
    <div className="map-layout">
      <div className="map-pane">
        <MapContainer
          center={center}
          zoom={13}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {mapped.map((proj, i) => (
            <Marker
              key={i}
              position={[proj.coords.lat, proj.coords.lng]}
              icon={coloredIcon(SOURCE_COLORS[proj.source] || '#64748b')}
              eventHandlers={{ click: () => setSelected(proj) }}
            >
              <Popup>
                <strong>{proj.title}</strong>
                <br />
                <span style={{ fontSize: '0.8em', color: '#555' }}>
                  {proj.source === 'roadway_alerts' ? 'Roadway Alert' : 'Flood Mitigation'}
                </span>
                {proj.url && (
                  <>
                    <br />
                    <a href={proj.url} target="_blank" rel="noreferrer" style={{ fontSize: '0.8em' }}>
                      More info ↗
                    </a>
                  </>
                )}
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>

      <div className="map-sidebar">
        {/* Legend */}
        <div style={{ marginBottom: '1rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: SOURCE_COLORS.roadway_alerts, display: 'inline-block' }} />
            Roadway
          </span>
          <span style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: SOURCE_COLORS.flood_mitigation, display: 'inline-block' }} />
            Flood/Stormwater
          </span>
        </div>

        <h3>Mapped projects ({mapped.length})</h3>
        {mapped.map((proj, i) => (
          <div
            key={i}
            className="map-item"
            onClick={() => setSelected(proj)}
            style={selected === proj ? { background: 'var(--brand-light)' } : {}}
          >
            <div className="map-item-title">{proj.title}</div>
            <div className="map-item-sub">
              {proj.source === 'roadway_alerts' ? '🚧 Roadway' : '💧 Flood/Stormwater'}
              {proj.url && (
                <> · <a href={proj.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>details ↗</a></>
              )}
            </div>
          </div>
        ))}

        {unmapped.length > 0 && (
          <>
            <h3 style={{ marginTop: '1.25rem' }}>Not yet mapped ({unmapped.length})</h3>
            {unmapped.map((proj, i) => (
              <div key={i} className="map-item" style={{ opacity: 0.65 }}>
                <div className="map-item-title">{proj.title}</div>
                <div className="map-item-sub">
                  {proj.url && <a href={proj.url} target="_blank" rel="noreferrer">details ↗</a>}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
