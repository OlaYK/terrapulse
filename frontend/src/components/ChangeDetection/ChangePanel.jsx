import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { Activity, Copy, Download, Loader2, Play, Share2, Trash2 } from 'lucide-react'

import { computeChange, getChangeModes } from '../../services/api'
import { bboxCoverageRatio, describeBbox } from '../../utils/geo'
import { buildShareUrl, compactScene } from '../../utils/share'

const FALLBACK_MODE = {
  id: 'analysis',
  name: 'Analysis',
  plain_label: 'Change detection',
  plain_summary: 'Compares the selected before and after scenes and highlights meaningful change.',
  positive_label: 'Positive change',
  negative_label: 'Negative change',
  formula: '',
}

export default function ChangePanel({ sceneA, sceneB, bbox, initialAnalysis, onOverlayReady, onClear }) {
  const [modes, setModes] = useState([])
  const [mode, setMode] = useState('ndvi')
  const [threshold, setThreshold] = useState(0.1)
  const [resolution, setResolution] = useState(64)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [copyStatus, setCopyStatus] = useState('')
  const [downloadStatus, setDownloadStatus] = useState('')

  useEffect(() => {
    getChangeModes()
      .then((items) => {
        setModes(items)
        if (items[0]?.id) setMode(items[0].id)
      })
      .catch((err) => setError(err.message))
  }, [])

  useEffect(() => {
    if (!initialAnalysis) return
    if (initialAnalysis.mode) setMode(initialAnalysis.mode)
    if (Number.isFinite(initialAnalysis.threshold)) setThreshold(initialAnalysis.threshold)
    if (Number.isFinite(initialAnalysis.resolution)) setResolution(initialAnalysis.resolution)
  }, [initialAnalysis])

  const ready = Boolean(sceneA && sceneB && bbox)
  const selectedMode = modes.find((item) => item.id === mode) || FALLBACK_MODE
  const areaInfo = describeBbox(bbox)
  const guardrails = buildGuardrails({ sceneA, sceneB, bbox, areaInfo, resolution })
  const blockers = guardrails.filter((item) => item.level === 'error')
  const canRun = ready && blockers.length === 0 && !loading

  async function handleRun() {
    if (!canRun) return
    setLoading(true)
    setError('')
    setCopyStatus('')
    setDownloadStatus('')
    setResult(null)
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
    setCopyStatus('')
    setDownloadStatus('')
    onClear()
  }

  function clearStaleResult() {
    if (result) {
      setResult(null)
      onClear()
    }
    setCopyStatus('')
    setDownloadStatus('')
  }

  function handleModeSelect(nextMode) {
    setMode(nextMode)
    clearStaleResult()
  }

  function handleThresholdChange(nextThreshold) {
    setThreshold(nextThreshold)
    clearStaleResult()
  }

  function handleResolutionChange(nextResolution) {
    setResolution(nextResolution)
    clearStaleResult()
  }

  async function handleCopyShareLink() {
    setCopyStatus('')
    try {
      const link = buildShareUrl({
        version: 1,
        bbox,
        sceneA: compactScene(sceneA),
        sceneB: compactScene(sceneB),
        analysis: { mode, threshold, resolution },
      })
      await navigator.clipboard.writeText(link)
      setCopyStatus('Share link copied. It restores the scenes and settings; run analysis again to refresh the overlay.')
    } catch {
      setCopyStatus('Could not copy the link automatically in this browser.')
    }
  }

  async function handleCopySummary() {
    if (!result) return
    setCopyStatus('')
    try {
      await navigator.clipboard.writeText(buildTextSummary({
        sceneA,
        sceneB,
        bbox,
        areaInfo,
        modeConfig: selectedMode,
        threshold,
        resolution,
        result,
      }))
      setCopyStatus('Summary copied.')
    } catch {
      setCopyStatus('Could not copy the summary automatically in this browser.')
    }
  }

  function handleDownloadReport() {
    if (!result) return
    const report = buildReport({
      sceneA,
      sceneB,
      bbox,
      areaInfo,
      modeConfig: selectedMode,
      threshold,
      resolution,
      result,
    })
    downloadJson(report, `terrapulse-${mode}-${sceneA?.datetime || 'before'}-${sceneB?.datetime || 'after'}.json`)
    setDownloadStatus('Report downloaded as JSON.')
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

      {ready && (
        <div className="notice">
          Analysis area: {areaInfo.label}. The map currently uses the visible area, so zoom in before running analysis if you need a specific neighbourhood or floodplain.
        </div>
      )}

      {modes.length === 0 && !error && (
        <div className="notice notice-info" aria-live="polite">
          <Loader2 className="spin inline-icon" size={14} />
          Loading analysis options.
        </div>
      )}

      <div className="mode-grid">
        {modes.map((item) => (
          <button
            key={item.id}
            className={clsx('mode-button', mode === item.id && 'mode-button-active')}
            onClick={() => handleModeSelect(item.id)}
          >
            <Activity size={15} />
            <span>
              <strong>{item.name}</strong>
              <em>{item.plain_label}</em>
              <small>{item.plain_summary}</small>
              <code>{item.formula}</code>
            </span>
          </button>
        ))}
      </div>

      {guardrails.map((item) => (
        <div
          key={item.message}
          className={clsx('notice', item.level === 'error' ? 'notice-error' : 'notice-warning')}
        >
          {item.message}
        </div>
      ))}

      <label className="range-field">
        <span>Threshold</span>
        <input
          type="range"
          min="0.01"
          max="0.5"
          step="0.01"
          value={threshold}
          onChange={(event) => handleThresholdChange(Number(event.target.value))}
        />
        <strong>{threshold.toFixed(2)}</strong>
      </label>

      <label className="select-field">
        <span>Resolution</span>
        <select value={resolution} onChange={(event) => handleResolutionChange(Number(event.target.value))}>
          <option value={64}>64 px</option>
          <option value={128}>128 px</option>
          <option value={256}>256 px</option>
          <option value={512}>512 px</option>
        </select>
      </label>

      <div className="button-row">
        <button className="primary-button" onClick={handleRun} disabled={!canRun}>
          {loading ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
          <span>{loading ? 'Running analysis' : 'Run analysis'}</span>
        </button>
        <button className="secondary-button" onClick={handleClear} disabled={!result}>
          <Trash2 size={16} />
          <span>Clear</span>
        </button>
      </div>

      {loading && (
        <div className="notice notice-info" aria-live="polite">
          <Loader2 className="spin inline-icon" size={14} />
          Running {selectedMode.name}: reading remote Sentinel-2 bands, comparing the two dates, and preparing the map overlay.
        </div>
      )}
      {error && <div className="notice notice-error">{error}</div>}
      {copyStatus && <div className="notice">{copyStatus}</div>}
      {downloadStatus && <div className="notice">{downloadStatus}</div>}
      {result && (
        <Stats
          result={result}
          modeConfig={selectedMode}
          onCopyShareLink={handleCopyShareLink}
          onCopySummary={handleCopySummary}
          onDownloadReport={handleDownloadReport}
        />
      )}
    </section>
  )
}

function Stats({ result, modeConfig, onCopyShareLink, onCopySummary, onDownloadReport }) {
  const stats = result.stats
  return (
    <div className="panel-section">
      <h3>{result.mode_name} results</h3>
      <p className="section-help">{modeConfig.plain_summary}</p>
      <div className="stats-grid">
        <Stat label="Changed area" value={`${stats.change_percent}%`} />
        <Stat label={modeConfig.positive_label} value={`${stats.positive_change_percent}%`} />
        <Stat label={modeConfig.negative_label} value={`${stats.negative_change_percent}%`} />
        <Stat label="Mean" value={stats.mean_change.toFixed(4)} />
      </div>
      <div className="notice">
        {stats.change_percent}% of sampled pixels changed beyond the threshold. Positive color means {modeConfig.positive_label.toLowerCase()}; negative color means {modeConfig.negative_label.toLowerCase()}.
      </div>
      <div className="legend-row">
        <span><i style={{ background: result.color_legend.negative }} /> {modeConfig.negative_label}</span>
        <span><i style={{ background: result.color_legend.positive }} /> {modeConfig.positive_label}</span>
      </div>
      <div className="export-grid">
        <button className="secondary-button" onClick={onCopyShareLink}>
          <Share2 size={15} />
          <span>Share link</span>
        </button>
        <button className="secondary-button" onClick={onCopySummary}>
          <Copy size={15} />
          <span>Copy summary</span>
        </button>
        <button className="secondary-button" onClick={onDownloadReport}>
          <Download size={15} />
          <span>Report JSON</span>
        </button>
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

function buildGuardrails({ sceneA, sceneB, bbox, areaInfo, resolution }) {
  const items = []
  if (!sceneA || !sceneB || !bbox) return items

  if (sceneA.id === sceneB.id) {
    items.push({ level: 'error', message: 'Choose two different scenes. The before and after selections are currently the same scene.' })
  }

  const beforeCoverage = bboxCoverageRatio(bbox, sceneA.bbox)
  const afterCoverage = bboxCoverageRatio(bbox, sceneB.bbox)
  const minCoverage = Math.min(beforeCoverage, afterCoverage)

  if (minCoverage <= 0) {
    items.push({ level: 'error', message: 'The visible map area does not overlap both selected scenes. Pan back into the selected scene area or search again.' })
  } else if (minCoverage < 0.98) {
    items.push({ level: 'warning', message: 'The visible area is only partly covered by both scenes. Zoom or pan inside the shared footprint for a cleaner comparison.' })
  }

  if (areaInfo.veryLarge) {
    items.push({ level: 'warning', message: 'This is a very large analysis area. It may be slow and the result will be less detailed. Zoom in for neighbourhood-scale work.' })
  } else if (areaInfo.large) {
    items.push({ level: 'warning', message: 'This is a large analysis area. Start with 64 px or 128 px, then increase resolution after the area is narrowed.' })
  }

  if (resolution >= 512) {
    items.push({ level: 'warning', message: '512 px gives more detail but reads more remote satellite data. Use it only after the area is small and the scenes look correct.' })
  }

  return items
}

function buildReport({ sceneA, sceneB, bbox, areaInfo, modeConfig, threshold, resolution, result }) {
  return {
    generated_at: new Date().toISOString(),
    app: 'TerraPulse',
    area: {
      bbox,
      size: areaInfo.label,
      approximate_area_km2: Math.round(areaInfo.areaKm2),
    },
    before_scene: compactScene(sceneA),
    after_scene: compactScene(sceneB),
    analysis: {
      id: modeConfig.id,
      name: modeConfig.name,
      shows: modeConfig.plain_summary,
      formula: modeConfig.formula,
      threshold,
      resolution_px: resolution,
    },
    result: result.stats,
  }
}

function buildTextSummary({ sceneA, sceneB, areaInfo, modeConfig, threshold, resolution, result }) {
  const stats = result.stats
  return [
    `TerraPulse ${modeConfig.name} analysis`,
    `Shows: ${modeConfig.plain_summary}`,
    `Before: ${sceneA?.datetime || sceneA?.id}`,
    `After: ${sceneB?.datetime || sceneB?.id}`,
    `Area: ${areaInfo.label}`,
    `Threshold: ${threshold.toFixed(2)}`,
    `Resolution: ${resolution} px`,
    `Changed area: ${stats.change_percent}%`,
    `${modeConfig.positive_label}: ${stats.positive_change_percent}%`,
    `${modeConfig.negative_label}: ${stats.negative_change_percent}%`,
    `Mean change: ${stats.mean_change.toFixed(4)}`,
  ].join('\n')
}

function downloadJson(data, fileName) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = sanitizeFileName(fileName)
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function sanitizeFileName(value) {
  return value.replace(/[^a-z0-9_.-]+/gi, '-').toLowerCase()
}
