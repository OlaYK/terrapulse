import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { Activity, Loader2, Play, Trash2 } from 'lucide-react'

import { computeChange, getChangeModes } from '../../services/api'

export default function ChangePanel({ sceneA, sceneB, bbox, onOverlayReady, onClear }) {
  const [modes, setModes] = useState([])
  const [mode, setMode] = useState('ndvi')
  const [threshold, setThreshold] = useState(0.1)
  const [resolution, setResolution] = useState(64)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  useEffect(() => {
    getChangeModes()
      .then((items) => {
        setModes(items)
        if (items[0]?.id) setMode(items[0].id)
      })
      .catch((err) => setError(err.message))
  }, [])

  const ready = Boolean(sceneA && sceneB && bbox)

  async function handleRun() {
    if (!ready) return
    setLoading(true)
    setError('')
    try {
      const response = await computeChange({
        sceneA,
        sceneB,
        bbox,
        mode,
        threshold,
        resolution,
      })
      setResult(response)
      onOverlayReady(response.overlay_url)
    } catch (err) {
      setError(err.message)
      setResult(null)
    } finally {
      setLoading(false)
    }
  }

  function handleClear() {
    setResult(null)
    onClear()
  }

  return (
    <section className="tool-panel">
      <header className="panel-header">
        <span>Spectral math</span>
        <h2>Analyse</h2>
      </header>

      {!ready && (
        <div className="notice">
          Select before and after scenes, then run an analysis over the visible area.
        </div>
      )}

      <div className="mode-grid">
        {modes.map((item) => (
          <button
            key={item.id}
            className={clsx('mode-button', mode === item.id && 'mode-button-active')}
            onClick={() => setMode(item.id)}
          >
            <Activity size={15} />
            <span>
              <strong>{item.name}</strong>
              <small>{item.formula}</small>
            </span>
          </button>
        ))}
      </div>

      <label className="range-field">
        <span>Threshold</span>
        <input
          type="range"
          min="0.01"
          max="0.5"
          step="0.01"
          value={threshold}
          onChange={(event) => setThreshold(Number(event.target.value))}
        />
        <strong>{threshold.toFixed(2)}</strong>
      </label>

      <label className="select-field">
        <span>Resolution</span>
        <select value={resolution} onChange={(event) => setResolution(Number(event.target.value))}>
          <option value={64}>64 px</option>
          <option value={128}>128 px</option>
          <option value={256}>256 px</option>
          <option value={512}>512 px</option>
        </select>
      </label>

      <div className="button-row">
        <button className="primary-button" onClick={handleRun} disabled={!ready || loading}>
          {loading ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
          <span>Run analysis</span>
        </button>
        <button className="secondary-button" onClick={handleClear} disabled={!result}>
          <Trash2 size={16} />
          <span>Clear</span>
        </button>
      </div>

      {error && <div className="notice notice-error">{error}</div>}
      {result && <Stats result={result} />}
    </section>
  )
}

function Stats({ result }) {
  const stats = result.stats
  return (
    <div className="panel-section">
      <h3>{result.mode_name} results</h3>
      <div className="stats-grid">
        <Stat label="Changed" value={`${stats.change_percent}%`} />
        <Stat label="Positive" value={`${stats.positive_change_percent}%`} />
        <Stat label="Negative" value={`${stats.negative_change_percent}%`} />
        <Stat label="Mean" value={stats.mean_change.toFixed(4)} />
      </div>
      <div className="legend-row">
        <span><i style={{ background: result.color_legend.negative }} /> Negative</span>
        <span><i style={{ background: result.color_legend.positive }} /> Positive</span>
      </div>
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="stat-tile">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}
