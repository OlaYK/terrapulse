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

  function handleExportReport() {
    if (!result) return
    const reportHtml = buildReportHtml({
      sceneA,
      sceneB,
      bbox,
      areaInfo,
      modeConfig: selectedMode,
      threshold,
      resolution,
      result,
    })
    const fileName = `terrapulse-${mode}-${sceneA?.datetime || 'before'}-${sceneB?.datetime || 'after'}`
    const reportWindow = window.open('', '_blank', 'noopener,noreferrer,width=920,height=1100')

    if (!reportWindow) {
      downloadHtml(reportHtml, `${fileName}.html`)
      setDownloadStatus('Popup blocked. A readable HTML report was downloaded instead.')
      return
    }

    reportWindow.document.open()
    reportWindow.document.write(reportHtml)
    reportWindow.document.close()
    reportWindow.focus()
    window.setTimeout(() => reportWindow.print(), 350)
    setDownloadStatus('Report opened. Choose Save as PDF in the print dialog.')
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
          onExportReport={handleExportReport}
        />
      )}
    </section>
  )
}

function Stats({ result, modeConfig, onCopyShareLink, onCopySummary, onExportReport }) {
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
        <button className="secondary-button" onClick={onExportReport}>
          <Download size={15} />
          <span>PDF report</span>
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

function buildReportHtml({ sceneA, sceneB, bbox, areaInfo, modeConfig, threshold, resolution, result }) {
  const stats = result.stats
  const generatedAt = new Date().toLocaleString()
  const title = `TerraPulse ${modeConfig.name} Analysis Report`
  const bboxText = Array.isArray(bbox) ? bbox.map((value) => value.toFixed(5)).join(', ') : 'Unavailable'
  const overlayImage = result.overlay_url
    ? `<figure><img src="${result.overlay_url}" alt="Analysis overlay" /><figcaption>Analysis overlay. Positive and negative colors are listed in the legend.</figcaption></figure>`
    : ''

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color: #172033; font-family: Arial, Helvetica, sans-serif; }
    body { margin: 0; background: #f4f7fb; }
    main { max-width: 860px; margin: 0 auto; padding: 36px; background: #fff; min-height: 100vh; }
    h1 { margin: 0 0 8px; font-size: 28px; }
    h2 { margin: 28px 0 10px; font-size: 17px; text-transform: uppercase; letter-spacing: 0.06em; }
    p { line-height: 1.55; }
    .muted { color: #5f6c7b; }
    .summary { border: 1px solid #d7dee8; padding: 16px; background: #f8fafc; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .stat { border: 1px solid #d7dee8; padding: 12px; }
    .stat span { display: block; color: #5f6c7b; font-size: 12px; }
    .stat strong { display: block; margin-top: 4px; font-size: 22px; }
    table { width: 100%; border-collapse: collapse; }
    td, th { border: 1px solid #d7dee8; padding: 9px; text-align: left; vertical-align: top; }
    th { background: #eef3f8; }
    code { overflow-wrap: anywhere; }
    figure { margin: 16px 0 0; }
    img { max-width: 100%; border: 1px solid #d7dee8; image-rendering: auto; }
    figcaption { color: #5f6c7b; font-size: 12px; margin-top: 6px; }
    .legend { display: flex; gap: 16px; flex-wrap: wrap; }
    .swatch { display: inline-block; width: 12px; height: 12px; margin-right: 6px; vertical-align: -1px; }
    @media print {
      body { background: #fff; }
      main { padding: 0; max-width: none; }
      button { display: none; }
    }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    <p class="muted">Generated ${escapeHtml(generatedAt)}</p>

    <section class="summary">
      <strong>${escapeHtml(modeConfig.plain_label)}</strong>
      <p>${escapeHtml(modeConfig.plain_summary)}</p>
      <p><strong>Technical formula:</strong> <code>${escapeHtml(modeConfig.formula || 'Not applicable')}</code></p>
    </section>

    <h2>Result</h2>
    <div class="grid">
      ${statHtml('Changed area', `${stats.change_percent}%`)}
      ${statHtml(modeConfig.positive_label, `${stats.positive_change_percent}%`)}
      ${statHtml(modeConfig.negative_label, `${stats.negative_change_percent}%`)}
      ${statHtml('Mean change', stats.mean_change.toFixed(4))}
    </div>
    <p>${escapeHtml(stats.change_percent)}% of sampled pixels changed beyond the threshold. Positive color means ${escapeHtml(modeConfig.positive_label.toLowerCase())}; negative color means ${escapeHtml(modeConfig.negative_label.toLowerCase())}.</p>
    <div class="legend">
      <span><i class="swatch" style="background:${escapeHtml(result.color_legend.positive)}"></i>${escapeHtml(modeConfig.positive_label)}</span>
      <span><i class="swatch" style="background:${escapeHtml(result.color_legend.negative)}"></i>${escapeHtml(modeConfig.negative_label)}</span>
    </div>
    ${overlayImage}

    <h2>Analysis Settings</h2>
    <table>
      <tbody>
        ${rowHtml('Area size', `${areaInfo.label} (${Math.round(areaInfo.areaKm2)} sq km approx.)`)}
        ${rowHtml('Bounding box', bboxText)}
        ${rowHtml('Threshold', threshold.toFixed(2))}
        ${rowHtml('Resolution', `${resolution} px`)}
      </tbody>
    </table>

    <h2>Scenes</h2>
    <table>
      <thead>
        <tr><th>Role</th><th>Date</th><th>Cloud</th><th>Scene ID</th></tr>
      </thead>
      <tbody>
        ${sceneRowHtml('Before', sceneA)}
        ${sceneRowHtml('After', sceneB)}
      </tbody>
    </table>

    <h2>Note</h2>
    <p class="muted">Sentinel-2 is useful for broad land-cover and environmental monitoring, but it is not sub-meter imagery. Treat this report as screening evidence for further review.</p>
  </main>
</body>
</html>`
}

function statHtml(label, value) {
  return `<div class="stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`
}

function rowHtml(label, value) {
  return `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`
}

function sceneRowHtml(role, scene) {
  return `<tr>
    <td>${escapeHtml(role)}</td>
    <td>${escapeHtml(scene?.datetime || 'Unknown')}</td>
    <td>${escapeHtml(scene?.cloud_cover != null ? `${scene.cloud_cover.toFixed(1)}%` : 'Unavailable')}</td>
    <td><code>${escapeHtml(scene?.id || 'Unavailable')}</code></td>
  </tr>`
}

function downloadHtml(html, fileName) {
  const blob = new Blob([html], { type: 'text/html' })
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

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
