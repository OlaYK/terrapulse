import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { CalendarDays, Cloud, Loader2, Search } from 'lucide-react'

import { DEFAULT_NIGERIA_BBOX, searchScenes } from '../../services/api'
import { describeBbox } from '../../utils/geo'

export default function ScenePicker({ bbox, sceneA, sceneB, onSceneASelect, onSceneBSelect }) {
  const defaults = useMemo(() => makeDateDefaults(), [])
  const [beforeStart, setBeforeStart] = useState(defaults.beforeStart)
  const [beforeEnd, setBeforeEnd] = useState(defaults.beforeEnd)
  const [afterStart, setAfterStart] = useState(defaults.afterStart)
  const [afterEnd, setAfterEnd] = useState(defaults.afterEnd)
  const [maxCloudCover, setMaxCloudCover] = useState(25)
  const [beforeScenes, setBeforeScenes] = useState([])
  const [afterScenes, setAfterScenes] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [searched, setSearched] = useState(false)

  const activeBbox = bbox || DEFAULT_NIGERIA_BBOX
  const areaInfo = useMemo(() => describeBbox(activeBbox), [activeBbox])

  async function handleSearch() {
    setLoading(true)
    setError('')
    setSearched(true)
    try {
      const [before, after] = await Promise.all([
        searchScenes({
          bbox: activeBbox,
          dateStart: beforeStart,
          dateEnd: beforeEnd,
          maxCloudCover,
          limit: 5,
        }),
        searchScenes({
          bbox: activeBbox,
          dateStart: afterStart,
          dateEnd: afterEnd,
          maxCloudCover,
          limit: 5,
        }),
      ])
      setBeforeScenes(before)
      setAfterScenes(after)
    } catch (err) {
      setError(err.message)
      setBeforeScenes([])
      setAfterScenes([])
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="tool-panel">
      <header className="panel-header">
        <span>Sentinel-2 L2A</span>
        <h2>Scenes</h2>
      </header>

      <div className={clsx('notice', areaInfo.large && 'notice-warning')}>
        Search area: {areaInfo.label}. Sentinel-2 scenes are best compared after you zoom to the specific area you care about.
      </div>

      {loading && (
        <div className="notice notice-info" aria-live="polite">
          <Loader2 className="spin inline-icon" size={14} />
          Fetching before and after Sentinel-2 scenes from Earth Search. This can take a moment.
        </div>
      )}

      <div className="date-grid">
        <DateRange title="Before" start={beforeStart} end={beforeEnd} onStart={setBeforeStart} onEnd={setBeforeEnd} />
        <DateRange title="After" start={afterStart} end={afterEnd} onStart={setAfterStart} onEnd={setAfterEnd} />
      </div>

      <label className="range-field">
        <span>
          <Cloud size={15} />
          Cloud cover
        </span>
        <input
          type="range"
          min="0"
          max="80"
          step="5"
          value={maxCloudCover}
          onChange={(event) => setMaxCloudCover(Number(event.target.value))}
        />
        <strong>{maxCloudCover}%</strong>
      </label>

      <button className="primary-button" onClick={handleSearch} disabled={loading}>
        {loading ? <Loader2 className="spin" size={16} /> : <Search size={16} />}
        <span>{loading ? 'Fetching scenes' : 'Find scenes'}</span>
      </button>

      {error && <div className="notice notice-error">{error}</div>}

      <SceneColumn
        title="Before"
        scenes={beforeScenes}
        selected={sceneA}
        onSelect={onSceneASelect}
        loading={loading}
        searched={searched}
      />
      <SceneColumn
        title="After"
        scenes={afterScenes}
        selected={sceneB}
        onSelect={onSceneBSelect}
        loading={loading}
        searched={searched}
      />
    </section>
  )
}

function DateRange({ title, start, end, onStart, onEnd }) {
  return (
    <fieldset className="date-range">
      <legend>
        <CalendarDays size={14} />
        {title}
      </legend>
      <label>
        <span>Start</span>
        <input type="date" value={start} onChange={(event) => onStart(event.target.value)} />
      </label>
      <label>
        <span>End</span>
        <input type="date" value={end} onChange={(event) => onEnd(event.target.value)} />
      </label>
    </fieldset>
  )
}

function SceneColumn({ title, scenes, selected, onSelect, loading, searched }) {
  return (
    <div className="panel-section">
      <h3>{title}</h3>
      <div className="list-stack">
        {loading && <div className="empty-list">Searching {title.toLowerCase()} date window...</div>}
        {!loading && scenes.length === 0 && (
          <div className="empty-list">
            {searched ? 'No scenes found for this date range and cloud limit.' : 'No scenes loaded yet.'}
          </div>
        )}
        {scenes.map((scene) => (
          <button
            key={scene.id}
            className={clsx('scene-card', selected?.id === scene.id && 'scene-card-selected')}
            onClick={() => onSelect(scene)}
          >
            {scene.thumbnail_url ? (
              <img src={scene.thumbnail_url} alt="" loading="lazy" />
            ) : (
              <span className="scene-thumb-fallback">S2</span>
            )}
            <span className="scene-copy">
              <strong>{scene.datetime || 'Unknown date'}</strong>
              <small>{scene.cloud_cover != null ? `${scene.cloud_cover.toFixed(1)}% cloud` : 'Cloud data unavailable'}</small>
              <code>{scene.id}</code>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function makeDateDefaults() {
  const today = new Date()
  const afterEnd = toDateInput(today)
  const afterStart = toDateInput(addDays(today, -90))
  const beforeEnd = toDateInput(addDays(today, -365))
  const beforeStart = toDateInput(addDays(today, -455))
  return { beforeStart, beforeEnd, afterStart, afterEnd }
}

function addDays(date, days) {
  const copy = new Date(date)
  copy.setDate(copy.getDate() + days)
  return copy
}

function toDateInput(date) {
  return date.toISOString().slice(0, 10)
}
