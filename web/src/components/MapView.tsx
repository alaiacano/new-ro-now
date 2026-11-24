import { useState, useMemo } from 'react'
import { X } from 'lucide-react'
import { ExtLink, YearPicker, type YearOption } from './ui'
import { MapContainer, TileLayer, Marker, Tooltip } from 'react-leaflet'
import MarkerClusterGroup from 'react-leaflet-cluster'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type {
  ConstructionItem, PavingEntry, DocMapEntry, SelectedItem,
} from '../types'

// Fix Leaflet default marker icon path issue with bundlers
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const COLORS: Record<'roadway_alerts' | 'flood_mitigation', string> = {
  roadway_alerts:   '#c95f06',
  flood_mitigation: '#2f6fa3',
}

// Distinct colors per paving year (cycles if more than palette length)
const PAVING_COLORS = ['#0f6b45', '#4d8b31', '#7c3aed', '#db2777', '#0d9488']

// Colors for document classifications — cycles if more classes than entries
const DOC_CLASS_COLORS = [
  '#9333ea', '#0891b2', '#b45309', '#be185d',
  '#15803d', '#1d4ed8', '#c2410c', '#6d28d9',
  '#0f766e', '#b91c1c', '#1e40af', '#92400e',
]

function pavingColor(yearIndex: number): string {
  return PAVING_COLORS[yearIndex % PAVING_COLORS.length]
}

function docClassColor(index: number): string {
  return DOC_CLASS_COLORS[index % DOC_CLASS_COLORS.length]
}

function coloredIcon(color: string, size = 14): L.DivIcon {
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

interface ConstructionLayer {
  id: 'roadway_alerts' | 'flood_mitigation'
  label: string
}

const CONSTRUCTION_LAYERS: ConstructionLayer[] = [
  { id: 'roadway_alerts',   label: 'Roadway alerts' },
  { id: 'flood_mitigation', label: 'Flood and stormwater' },
]

interface PavingGroup {
  year: string
  entries: PavingEntry[]
  color: string
  layerId: string
}

interface DocGroup {
  cls: string
  docs: DocMapEntry[]
  color: string
  layerId: string
  label: string
}

interface Props {
  construction: ConstructionItem[]
  paving: PavingEntry[]
  docMap?: DocMapEntry[]
  fromYear: YearOption
  onYear: (y: YearOption) => void
}

const MAP_EXCLUDED_CLASSIFICATIONS = new Set([
  'press_release', 'agenda', 'public_hearing', 'specification',
])

export default function MapView({ construction, paving, docMap = [], fromYear, onYear }: Props) {
  const [selected, setSelected] = useState<SelectedItem | null>(null)
  const [hiddenLayers, setHiddenLayers] = useState<Set<string>>(new Set())

  function toggleLayer(id: string) {
    setHiddenLayers(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const mappedConstruction = construction.filter(p => p.coords)
  const unmappedConstruction = construction.filter(p => !p.coords)

  // Group paving by year; deduplicate by street name within each year
  const pavingByYear = useMemo<PavingGroup[]>(() => {
    const map: Record<string, Map<string, PavingEntry>> = {}
    paving.forEach(p => {
      if (!p.coords) return
      const yr = String(p.year ?? 'Unknown')
      if (!map[yr]) map[yr] = new Map()
      if (!map[yr].has(p.street)) map[yr].set(p.street, p)
    })
    return Object.entries(map)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([year, streetMap], idx) => ({
        year,
        entries: Array.from(streetMap.values()),
        color: pavingColor(idx),
        layerId: `paving_${year}`,
      }))
  }, [paving])

  // Filter doc_map by year and excluded classifications, then group by classification
  const docByClassification = useMemo<DocGroup[]>(() => {
    const year = typeof fromYear === 'number' ? fromYear : null
    const cutoff = year ? new Date(`${year}-01-01`) : null
    const filtered = docMap.filter(d => {
      if (d.classification && MAP_EXCLUDED_CLASSIFICATIONS.has(d.classification)) return false
      if (!cutoff) return true
      if (!d.relevant_date) return false
      const dt = new Date(d.relevant_date)
      return !isNaN(dt.getTime()) && dt >= cutoff
    })

    const groups: Record<string, DocMapEntry[]> = {}
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

  const center: [number, number] = [40.9115, -73.7824]

  return (
    <div className="map-layout">
      <div className="map-pane">
        <MapContainer center={center} zoom={13} style={{ height: '100%', width: '100%' }}>
          {/* Standard OSM tiles; dimmed in dark mode (see .basemap in App.css). */}
          <TileLayer
            className="basemap"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <MarkerClusterGroup chunkedLoading>
          {!hiddenLayers.has('roadway_alerts') && mappedConstruction
            .filter(p => p.source === 'roadway_alerts')
            .map((proj, i) => (
              <Marker key={`road-${i}`} position={[proj.coords!.lat, proj.coords!.lng]}
                icon={coloredIcon(COLORS.roadway_alerts)}
                eventHandlers={{ click: () => setSelected({ ...proj, _type: 'construction' }) }}>
                <Tooltip direction="top" offset={[0, -6]}>
                  <strong>{proj.title}</strong><br />
                  <span className="tip-sub">Roadway alert</span>
                </Tooltip>
              </Marker>
            ))}

          {!hiddenLayers.has('flood_mitigation') && mappedConstruction
            .filter(p => p.source === 'flood_mitigation')
            .map((proj, i) => (
              <Marker key={`flood-${i}`} position={[proj.coords!.lat, proj.coords!.lng]}
                icon={coloredIcon(COLORS.flood_mitigation)}
                eventHandlers={{ click: () => setSelected({ ...proj, _type: 'construction' }) }}>
                <Tooltip direction="top" offset={[0, -6]}>
                  <strong>{proj.title}</strong><br />
                  <span className="tip-sub">Flood and stormwater</span>
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
                  <span className="tip-sub">{doc.classification?.replace(/_/g, ' ')}{doc.relevant_date && `, ${doc.relevant_date}`}</span>
                </Tooltip>
              </Marker>
            ))
          )}

          {pavingByYear.map(({ year, entries, color, layerId }) =>
            !hiddenLayers.has(layerId) && entries.map((entry, i) => (
              <Marker key={`pave-${year}-${i}`} position={[entry.coords!.lat, entry.coords!.lng]}
                icon={coloredIcon(color, 12)}
                eventHandlers={{ click: () => setSelected({ ...entry, _type: 'paving' }) }}>
                <Tooltip direction="top" offset={[0, -6]}>
                  <strong>{entry.street}</strong><br />
                  <span className="tip-sub">
                    {year} paving, {entry.list}
                    {entry.to && entry.from && <>: {entry.from} to {entry.to}</>}
                  </span>
                </Tooltip>
              </Marker>
            ))
          )}
          </MarkerClusterGroup>
        </MapContainer>
      </div>

      <aside className="map-sidebar" aria-label="Map layers and projects">
        {selected && (
          <div className="map-detail">
            <button type="button" className="icon-btn" onClick={() => setSelected(null)} aria-label="Close details">
              <X size={16} />
            </button>
            <p className="map-detail-kind">
              {selected._type === 'paving' ? `Paving, ${selected.list}`
                : selected._type === 'document' ? (selected.classification ?? 'document').replace(/_/g, ' ')
                : selected.source === 'roadway_alerts' ? 'Roadway alert' : 'Flood and stormwater'}
            </p>
            <p className="map-detail-title">{selected._type === 'paving' ? selected.street : selected.title}</p>
            {selected._type === 'paving' && selected.to && (
              <p className="map-detail-text">{selected.from} to {selected.to}</p>
            )}
            {selected._type === 'document' && selected.description && (
              <p className="map-detail-text">{selected.description.slice(0, 220)}{selected.description.length > 220 ? '…' : ''}</p>
            )}
            {(selected._type === 'construction' || selected._type === 'document') && selected.url && (
              <ExtLink href={selected.url}>{selected._type === 'document' ? 'Open document' : 'Project details'}</ExtLink>
            )}
          </div>
        )}

        <div className="map-section">
          <div className="map-section-head">
            <h2>Layers</h2>
            <YearPicker value={fromYear} onChange={onYear} options={[2026, 2025, 2024, 2023, 2022, null]} />
          </div>
          <div className="layer-actions">
            <button type="button" onClick={() => setHiddenLayers(new Set())}>Show all</button>
            <button type="button" onClick={() => setHiddenLayers(new Set([
              ...CONSTRUCTION_LAYERS.map(l => l.id),
              ...docByClassification.map(d => d.layerId),
              ...pavingByYear.map(p => p.layerId),
            ]))}>Hide all</button>
          </div>

          {CONSTRUCTION_LAYERS.map(layer => (
            <LayerToggle key={layer.id} layerId={layer.id} label={layer.label} color={COLORS[layer.id]}
              count={mappedConstruction.filter(p => p.source === layer.id).length}
              hidden={hiddenLayers.has(layer.id)} onToggle={toggleLayer} />
          ))}
          {pavingByYear.map(({ year, entries, color, layerId }) => (
            <LayerToggle key={layerId} layerId={layerId} label={`Paving ${year}`} color={color}
              count={entries.length} hidden={hiddenLayers.has(layerId)} onToggle={toggleLayer} />
          ))}

          {docByClassification.length > 0 && <h3 className="layer-sub">From city documents</h3>}
          {docByClassification.map(({ docs, color, layerId, label }) => (
            <LayerToggle key={layerId} layerId={layerId} label={label} color={color}
              count={docs.length} hidden={hiddenLayers.has(layerId)} onToggle={toggleLayer} />
          ))}
        </div>

        <div className="map-section">
          <h2>Active projects <span className="count">{mappedConstruction.length}</span></h2>
          <ul className="map-list">
            {mappedConstruction.map((proj, i) => (
              <li key={i}>
                <button type="button" className="map-item"
                  aria-current={selected?._type === 'construction' && selected.title === proj.title ? 'true' : undefined}
                  onClick={() => setSelected({ ...proj, _type: 'construction' })}>
                  <span className="swatch" style={{ background: COLORS[proj.source] }} aria-hidden="true" />
                  <span>{proj.title}</span>
                </button>
              </li>
            ))}
          </ul>

          {unmappedConstruction.length > 0 && (
            <>
              <h3 className="layer-sub">Not on the map yet <span className="count">{unmappedConstruction.length}</span></h3>
              <ul className="map-list unmapped">
                {unmappedConstruction.map((proj, i) => (
                  <li key={i}>
                    {proj.url ? <a href={proj.url} target="_blank" rel="noreferrer">{proj.title}</a> : proj.title}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </aside>
    </div>
  )
}

interface LayerToggleProps {
  layerId: string
  label: string
  color: string
  count: number
  hidden: boolean
  onToggle: (id: string) => void
}

function LayerToggle({ layerId, label, color, count, hidden, onToggle }: LayerToggleProps) {
  return (
    <label className={`layer${hidden ? ' off' : ''}`}>
      <input type="checkbox" checked={!hidden} onChange={() => onToggle(layerId)} />
      <span className="swatch" style={{ background: color }} aria-hidden="true" />
      <span className="layer-label">{label}</span>
      <span className="layer-count">{count}</span>
    </label>
  )
}
