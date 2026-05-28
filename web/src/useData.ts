import { useState, useEffect } from 'react'
import type {
  AppData, Meeting, ConstructionItem, PavingEntry, Bid,
  NewsItem, PublicHearing, DocMapEntry, Meta,
} from './types'

const BASE = import.meta.env.BASE_URL + 'data/'

async function fetchJSON<T>(file: string): Promise<T> {
  const res = await fetch(BASE + file)
  if (!res.ok) throw new Error(`Failed to load ${file}: ${res.status}`)
  return res.json() as Promise<T>
}

interface UseDataResult {
  data: AppData
  loading: boolean
  error: string | null
}

export function useData(): UseDataResult {
  const [data, setData] = useState<AppData>({
    meetings: [],
    construction: [],
    paving: [],
    bids: [],
    news: [],
    public_hearings: [],
    doc_map: [],
    meta: {},
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      fetchJSON<Meeting[]>('meetings.json'),
      fetchJSON<ConstructionItem[]>('construction.json'),
      fetchJSON<PavingEntry[]>('paving.json').catch(() => [] as PavingEntry[]),
      fetchJSON<Bid[]>('bids.json'),
      fetchJSON<NewsItem[]>('news.json'),
      fetchJSON<PublicHearing[]>('public_hearings.json'),
      fetchJSON<Meta>('meta.json').catch(() => ({} as Meta)),
      // DocumentCenter doc exports — optional, fall back to empty if not yet generated
      fetchJSON<DocMapEntry[]>('doc_map.json').catch(() => [] as DocMapEntry[]),
      fetchJSON<Meeting[]>('doc_meetings.json').catch(() => [] as Meeting[]),
      fetchJSON<NewsItem[]>('doc_news.json').catch(() => [] as NewsItem[]),
      fetchJSON<Bid[]>('doc_bids.json').catch(() => [] as Bid[]),
    ])
      .then(([meetings, construction, paving, bids, news, public_hearings, meta,
              docMap, docMeetings, docNews, docBids]) => {

        // Merge doc meetings (skip any without a start date), sorted chronologically
        const allMeetings: Meeting[] = [
          ...meetings,
          ...docMeetings.filter(m => m.start),
        ].sort((a, b) => new Date(a.start as string).getTime() - new Date(b.start as string).getTime())

        // Merge doc news, sorted newest-first
        const allNews: NewsItem[] = [...news, ...docNews].sort((a, b) =>
          new Date(b.published || 0).getTime() - new Date(a.published || 0).getTime()
        )

        // Merge doc bids (appended after scraped bids)
        const allBids: Bid[] = [...bids, ...docBids]

        setData({ meetings: allMeetings, construction, paving, bids: allBids,
                  news: allNews, public_hearings, doc_map: docMap, meta })
        setLoading(false)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })
  }, [])

  return { data, loading, error }
}
