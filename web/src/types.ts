export interface Coords {
  lat: number
  lng: number
}

export interface Meeting {
  id: string
  calendar: string
  title: string
  start: string | null
  end?: string | null
  location?: string | null
  url?: string | null
  description?: string | null
  source?: string
  classification?: string
  folder?: string
  relevant_date?: string | null
}

export type ConstructionSource = 'roadway_alerts' | 'flood_mitigation'

export interface ConstructionItem {
  title: string
  url?: string
  description?: string
  source: ConstructionSource
  project_id?: string | number
  addresses?: string[]
  coords?: Coords | null
}

export interface PavingEntry {
  row?: number
  street: string
  to?: string | null
  from?: string | null
  list: 'citywide' | 'downtown' | string
  year?: number | string | null
  coords?: Coords | null
  note?: string | null
}

export interface Bid {
  bid_number?: string
  title: string
  status?: string
  closing_date?: string | null
  description?: string
  url?: string
  source?: string
  classification?: string
  folder?: string
  relevant_date?: string | null
}

export interface NewsItem {
  title: string
  url?: string
  description?: string
  published?: string | null
  category?: string
  source?: string
  classification?: string
  folder?: string
  relevant_date?: string | null
}

export interface PublicHearing {
  title: string
  url?: string
  date_text?: string
  source?: string
}

export interface DocMapEntry {
  id: number | string
  title: string
  url?: string
  description?: string
  location?: string
  coords: Coords
  classification?: string
  relevant_date?: string | null
}

export type Meta = Record<string, string | null | undefined>

export interface AppData {
  meetings: Meeting[]
  construction: ConstructionItem[]
  paving: PavingEntry[]
  bids: Bid[]
  news: NewsItem[]
  public_hearings: PublicHearing[]
  doc_map: DocMapEntry[]
  meta: Meta
}

// Discriminated union used by the MapView selection panel
export type SelectedItem =
  | (ConstructionItem & { _type: 'construction' })
  | (DocMapEntry & { _type: 'document' })
  | (PavingEntry & { _type: 'paving' })
