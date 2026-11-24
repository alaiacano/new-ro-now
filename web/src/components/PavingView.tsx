import { useState } from 'react'
import type { PavingEntry } from '../types'
import { Chips, Empty, ExtLink, ViewHeader } from './ui'

type Filter = 'all' | 'citywide' | 'downtown'

export default function PavingView({ paving }: { paving: PavingEntry[] }) {
  const [filter, setFilter] = useState<Filter>('all')

  const year = paving.find(p => p.year)?.year
  const filtered = filter === 'all' ? paving : paving.filter(p => p.list === filter)
  const streets = new Set(paving.map(p => p.street)).size
  const count = (f: Filter) => paving.filter(p => p.list === f).length

  return (
    <div className="page">
      <ViewHeader
        title={year ? `${year} paving schedule` : 'Paving schedule'}
        sub={<>
          {streets} streets are on this year&rsquo;s list. The city publishes the list without dates for
          individual streets. <ExtLink href="https://www.newrochelleny.gov/948/Paving">City paving page</ExtLink>
        </>}
      />

      <Chips label="Filter by list" value={filter} onChange={setFilter} items={[
        { key: 'all', label: 'All', count: paving.length },
        { key: 'citywide', label: 'Citywide', count: count('citywide') },
        { key: 'downtown', label: 'Downtown', count: count('downtown') },
      ]} />

      {filtered.length === 0
        ? <Empty title="No streets on this list." />
        : <ul className="street-list">
            {filtered.map((e, i) => {
              const ends = [e.from, e.to].filter(x => x && x !== 'None')
              return (
                <li key={i} className="street">
                  <span className="street-name">{e.street}{e.note && <span title="Partial block"> *</span>}</span>
                  <span className="street-span">
                    {ends.length === 2 ? `${ends[0]} to ${ends[1]}` : ends[0] ?? 'Full length'}
                  </span>
                  <span className={`tag ${e.list === 'downtown' ? 'water' : 'quiet'}`}>
                    {e.list === 'downtown' ? 'Downtown' : 'Citywide'}
                  </span>
                </li>
              )
            })}
          </ul>}
    </div>
  )
}
