import { useEffect, useState } from 'react'
import { Loader2, MapPin, Search } from 'lucide-react'

import { geocodeLocation, getLocations } from '../../services/api'

export default function LocationPanel({ onLocationSelect }) {
  const [locations, setLocations] = useState([])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [loadingPresets, setLoadingPresets] = useState(true)
  const [error, setError] = useState('')
  const [searched, setSearched] = useState(false)

  useEffect(() => {
    getLocations()
      .then(setLocations)
      .catch((err) => setError(err.message))
      .finally(() => setLoadingPresets(false))
  }, [])

  async function handleSearch(event) {
    event.preventDefault()
    if (!query.trim()) return
    setLoading(true)
    setError('')
    setSearched(true)
    try {
      setResults(await geocodeLocation(query.trim()))
    } catch (err) {
      setError(err.message)
      setResults([])
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="tool-panel">
      <PanelHeader eyebrow="Area of interest" title="Location" />

      <form className="search-row" onSubmit={handleSearch}>
        <Search size={16} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search city, river, region"
        />
        <button type="submit" className="square-button" disabled={loading} aria-label="Search">
          {loading ? <Loader2 className="spin" size={16} /> : <Search size={16} />}
        </button>
      </form>

      {error && <div className="notice notice-error">{error}</div>}
      {loading && (
        <div className="notice notice-info" aria-live="polite">
          <Loader2 className="spin inline-icon" size={14} />
          Searching OpenStreetMap place data. Broader names usually work best.
        </div>
      )}
      {searched && !loading && !error && results.length === 0 && (
        <div className="notice">No matching places found. Try adding the country, for example "Lekki, Nigeria" or "Accra, Ghana".</div>
      )}

      {results.length > 0 && (
        <div className="panel-section">
          <h3>Search results</h3>
          <div className="list-stack">
            {results.map((result) => (
              <button
                key={`${result.name}-${result.center.join(',')}`}
                className="location-card"
                onClick={() => onLocationSelect({ ...result, zoom: 13 })}
              >
                <MapPin size={16} />
                <span>
                  <strong>{result.name}</strong>
                  <small>{result.country || result.raw?.provider || 'OpenStreetMap result'}</small>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="panel-section">
        <h3>Presets</h3>
        <div className="list-stack">
          {loadingPresets && <div className="empty-list">Loading Nigeria-focused presets...</div>}
          {locations.map((location) => (
            <button
              key={location.id}
              className="location-card"
              onClick={() => onLocationSelect(location)}
            >
              <MapPin size={16} />
              <span>
                <strong>{location.name}</strong>
                <small>{location.description}</small>
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}

function PanelHeader({ eyebrow, title }) {
  return (
    <header className="panel-header">
      <span>{eyebrow}</span>
      <h2>{title}</h2>
    </header>
  )
}
