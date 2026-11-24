import { useState } from 'react'
import { MapPin } from 'lucide-react'
import type { ConstructionItem } from '../types'
import { Chips, Empty, ExtLink, ViewHeader } from './ui'

type Filter = 'all' | 'roadway_alerts' | 'flood_mitigation'

const GENERIC_FLOOD_URL = 'https://www.newrochelleny.gov/1831/Flood-Mitigation-Projects'

export default function ConstructionView({ construction }: { construction: ConstructionItem[] }) {
  const [filter, setFilter] = useState<Filter>('all')
  const filtered = filter === 'all' ? construction : construction.filter(p => p.source === filter)
  const count = (f: Filter) => construction.filter(p => p.source === f).length

  return (
    <div className="page">
      <ViewHeader
        title="Projects"
        sub={<>Active roadway alerts and flood and stormwater work. <a href="#map">See them on the map</a>.</>}
      />

      <Chips label="Filter by project type" value={filter} onChange={setFilter} items={[
        { key: 'all', label: 'All', count: construction.length },
        { key: 'roadway_alerts', label: 'Roadway', count: count('roadway_alerts') },
        { key: 'flood_mitigation', label: 'Flood and stormwater', count: count('flood_mitigation') },
      ]} />

      {filtered.length === 0
        ? <Empty title="No projects of this type right now." />
        : <ul className="rows panel">
            {filtered.map((p, i) => {
              const road = p.source === 'roadway_alerts'
              return (
                <li key={i} className={`row edge ${road ? 'edge-work' : 'edge-water'}`}>
                  <div className="row-body">
                    <p className="row-meta">
                      <span className={`tag ${road ? 'work' : 'water'}`}>{road ? 'Roadway' : 'Flood and stormwater'}</span>
                      {p.project_id && <span className="faint">Project {p.project_id}</span>}
                      {p.coords
                        ? <a className="mapped" href="#map"><MapPin size={13} aria-hidden="true" />On the map</a>
                        : <span className="faint">Location not mapped yet</span>}
                    </p>
                    <p className="row-title">{p.title}</p>
                    {p.addresses && p.addresses.length > 0 && <p className="row-text">{p.addresses.join('; ')}</p>}
                    {p.description && (
                      <p className="row-text">{p.description.slice(0, 300)}{p.description.length > 300 ? '…' : ''}</p>
                    )}
                    {p.url && p.url !== GENERIC_FLOOD_URL && (
                      <p className="row-foot"><ExtLink href={p.url}>Project details</ExtLink></p>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>}
    </div>
  )
}
