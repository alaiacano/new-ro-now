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
    bids: [],
    news: [],
    public_hearings: [],
    meta: {},
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    Promise.all([
      fetchJSON('meetings.json'),
      fetchJSON('construction.json'),
      fetchJSON('bids.json'),
      fetchJSON('news.json'),
      fetchJSON('public_hearings.json'),
      fetchJSON('meta.json').catch(() => ({})),
    ])
      .then(([meetings, construction, bids, news, public_hearings, meta]) => {
        setData({ meetings, construction, bids, news, public_hearings, meta })
        setLoading(false)
      })
      .catch(err => {
        setError(err.message)
        setLoading(false)
      })
  }, [])

  return { data, loading, error }
}
