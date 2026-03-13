import { useState, useEffect } from 'react'

const BASE = import.meta.env.BASE_URL + 'data/'

async function fetchJSON(file) {
  const res = await fetch(BASE + file)
  if (!res.ok) throw new Error(`Failed to load ${file}: ${res.status}`)
  return res.json()
}

export function useData() {
  const [data, setData] = useState({
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
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.all([
      fetchJSON('meetings.json'),
      fetchJSON('construction.json'),
      fetchJSON('paving.json').catch(() => []),
      fetchJSON('bids.json'),
      fetchJSON('news.json'),
      fetchJSON('public_hearings.json'),
      fetchJSON('meta.json').catch(() => ({})),
      // DocumentCenter doc exports — optional, fall back to empty if not yet generated
      fetchJSON('doc_map.json').catch(() => []),
      fetchJSON('doc_meetings.json').catch(() => []),
      fetchJSON('doc_news.json').catch(() => []),
      fetchJSON('doc_bids.json').catch(() => []),
    ])
      .then(([meetings, construction, paving, bids, news, public_hearings, meta,
              docMap, docMeetings, docNews, docBids]) => {

        // Merge doc meetings (skip any without a start date), sorted chronologically
        const allMeetings = [
          ...meetings,
          ...docMeetings.filter(m => m.start),
        ].sort((a, b) => new Date(a.start) - new Date(b.start))

        // Merge doc news, sorted newest-first
        const allNews = [...news, ...docNews].sort((a, b) =>
          new Date(b.published || 0) - new Date(a.published || 0)
        )

        // Merge doc bids (appended after scraped bids)
        const allBids = [...bids, ...docBids]

        setData({ meetings: allMeetings, construction, paving, bids: allBids,
                  news: allNews, public_hearings, doc_map: docMap, meta })
        setLoading(false)
      })
      .catch(err => {
        setError(err.message)
        setLoading(false)
      })
  }, [])

  return { data, loading, error }
}
