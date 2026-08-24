import { useEffect, useMemo, useState } from 'react'
import { api } from './api'
import { useCollaboration } from './collaboration'
import { ExportDialog } from './ExportDialog'
import { MapCanvas } from './MapCanvas'
import { MarkerDialog } from './MarkerDialog'
import { canManageMap, canRestore, editingEnabled, flattenAnnotations, initialVisibility, visibleLayerIDs } from './state'
import type { Annotation, Point, Revision, TacMap, User, World } from './types'

import { markerColors } from './markers'
const terrainCategories = ['terrain', 'roads', 'buildings', 'vegetation', 'labels', 'grid']
const tools = [{ value: 'pointer', label: 'Point', symbol: '☝', key: 'p' }, { value: 'marker', label: 'Marker', symbol: '⌖', key: 'm' }, { value: 'rotate', label: 'Rotate', symbol: '↻', key: 'r' }, { value: 'polyline', label: 'Line', symbol: '╱', key: 'l' }, { value: 'freehand', label: 'Freehand', symbol: '∿', key: 'f' }, { value: 'measure', label: 'Distance', symbol: '↔', key: 'd' }, { value: 'radius', label: 'Radius', symbol: '◯', key: 'c' }] as const
type ActiveTool = typeof tools[number]['value']

function typingIn(target: EventTarget | null) { return target instanceof HTMLElement && (target.isContentEditable || target.matches('input, textarea, select')) }
function styleLabel(value: string) { return value.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) }
function stylePreview(world: World, style: string, version = 0) {
  const base = `/api/worlds/${encodeURIComponent(world.name)}/assets/`
  let fallback = world.preview ? base + encodeURIComponent(world.preview) : ''
  if (world.format === 'raster') {
    const folder = ({ topo: '', 'color-relief': 'colorRelief/', 'topo-dark': 'topoDark/', 'topo-relief': 'topoRelief/' } as Record<string, string>)[style]
    if (folder !== undefined) fallback = `${base}${folder}0/0/0.png`
  }
  return { src: `/api/worlds/${encodeURIComponent(world.name)}/previews/${encodeURIComponent(style)}?v=${version}`, fallback }
}

function revisionDetails(revision: Revision) {
  if (revision.kind === 'history.restore') return { title: 'Revision restored', text: '' }
  const annotation = revision.data?.annotation
  if (annotation?.kind === 'note') {
    const action = revision.kind.endsWith('.create') ? 'added' : revision.kind.endsWith('.update') ? 'updated' : 'deleted'
    return { title: `Note ${action}`, text: annotation.text }
  }
  return { title: revision.kind.replace(/[._]/g, ' '), text: '' }
}

export function Editor({ initial, user, world, onBack, onTerrainUnavailable }: { initial: TacMap; user: User; world?: World; onBack(): void; onTerrainUnavailable?(): void }) {
  const collaboration = useCollaboration(initial.id, initial)
  const map = collaboration.map ?? initial
  const [visibility, setVisibility] = useState(() => initialVisibility(initial.layers))
  const [style, setStyle] = useState(world?.styles.includes('topo') ? 'topo' : world?.styles[0] ?? '')
  const [categories, setCategories] = useState<Record<string, boolean>>(() => Object.fromEntries(terrainCategories.map((name) => [name, true])))
  const [layerID, setLayerID] = useState(initial.layers[0]?.id ?? '')
  const [activeTool, setActiveTool] = useState<ActiveTool | null>(null)
  const [color, setColor] = useState('ColorBlack')
  const [icon, setIcon] = useState('mil_dot')
  const [label, setLabel] = useState('')
  const [rotation, setRotation] = useState(0)
  const [scale, setScale] = useState(1)
  const [placingMarkerAt, setPlacingMarkerAt] = useState<Point | null>(null)
  const [editingMarker, setEditingMarker] = useState<Annotation | null>(null)
  const [noteText, setNoteText] = useState('')
  const [sidebarTab, setSidebarTab] = useState<'draw' | 'notes' | 'settings' | 'history' | null>('draw')
  const [exporting, setExporting] = useState(false)
  const [revisions, setRevisions] = useState<Revision[]>([])
  useEffect(() => { if (!map.worldAvailable) onTerrainUnavailable?.() }, [map.worldAvailable, onTerrainUnavailable])
  useEffect(() => { setVisibility((current) => ({ ...initialVisibility(map.layers), ...current })); if (!map.layers.some(({ id }) => id === layerID)) setLayerID(map.layers[0]?.id ?? '') }, [map.layers, layerID])
  const manager = canManageMap(user, map)
  const admin = canRestore(user)
  const annotations = useMemo(() => flattenAnnotations(map.layers, visibility), [map.layers, visibility])
  const notes = annotations.filter(({ kind }) => kind === 'note')
  const restoredVersions = new Set(revisions.filter(({ kind }) => kind === 'history.restore').map(({ data }) => data?.snapshot?.version))
  const activeLayer = map.layers.find(({ id }) => id === layerID)
  const visibleTerrainCategories = world?.format === 'raster' ? ['terrain', 'grid'] : terrainCategories
  const editing = editingEnabled(collaboration.connected, map)
  const refreshHistory = () => api.revisions(map.id).then((values) => setRevisions([...values].reverse()))
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setActiveTool(null); return }
      if (!editing || event.ctrlKey || event.metaKey || event.altKey || typingIn(event.target)) return
      const tool = tools.find(({ key }) => key === event.key.toLowerCase())
      if (tool) setActiveTool((current) => current === tool.value ? null : tool.value)
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [editing])
  useEffect(() => {
    const frame = requestAnimationFrame(() => window.dispatchEvent(new Event('resize')))
    return () => cancelAnimationFrame(frame)
  }, [sidebarTab])

  return <main className={`editor-shell${sidebarTab ? ' sidebar-open' : ''}`}>
    <header className="editor-header">
      <button className="back-button" onClick={onBack} aria-label="Back to maps">← <span>Maps</span></button>
      {world && <details className="style-switcher" onMouseEnter={(event) => { event.currentTarget.open = true }} onMouseLeave={(event) => { event.currentTarget.open = false }}>
        <summary aria-label={`Map style: ${styleLabel(style)}`}><StylePreview world={world} style={style} label="Map style" /></summary>
        <div className="style-options">{world.styles.map((name) => <button type="button" className={name === style ? 'active' : ''} aria-pressed={name === style} key={name} onClick={() => setStyle(name)}><StylePreview world={world} style={name} label={styleLabel(name)} /></button>)}</div>
      </details>}
      <div className="editor-title"><small>{map.world} · v{map.version}</small><h1>{map.name}</h1></div>
      <span className={`connection ${collaboration.connected ? 'online' : 'offline'}`}><i />{collaboration.connected ? 'Live' : 'Offline'}</span>
      <div className="header-actions">
        <button className="primary" onClick={() => setExporting(true)}>Export plan</button>
      </div>
    </header>

    <nav className="sidebar-tabs" aria-label="Editor panels">
      <button type="button" aria-label="Draw" aria-controls="draw-panel" aria-pressed={sidebarTab === 'draw'} onClick={() => setSidebarTab((tab) => tab === 'draw' ? null : 'draw')}><span aria-hidden="true">╱</span><small>Draw</small></button>
      <button type="button" aria-label="Notes" aria-controls="notes-panel" aria-pressed={sidebarTab === 'notes'} onClick={() => setSidebarTab((tab) => tab === 'notes' ? null : 'notes')}><span aria-hidden="true">▤</span><small>Notes</small>{notes.length > 0 && <b>{notes.length}</b>}</button>
      {manager && <button type="button" aria-label="Settings" aria-controls="settings-panel" aria-pressed={sidebarTab === 'settings'} onClick={() => setSidebarTab((tab) => tab === 'settings' ? null : 'settings')}><span aria-hidden="true">⚙</span><small>Settings</small></button>}
      {admin && <button type="button" aria-label="History" aria-controls="history-panel" aria-pressed={sidebarTab === 'history'} onClick={() => { if (sidebarTab === 'history') setSidebarTab(null); else { setSidebarTab('history'); refreshHistory() } }}><span aria-hidden="true">↶</span><small>History</small></button>}
    </nav>

    <aside id="draw-panel" className="sidebar" aria-label="Drawing controls" hidden={sidebarTab !== 'draw'}>
      <section className="side-section">
        <div className="side-heading"><span><small>01</small><strong>Map view</strong></span></div>
        <fieldset className="toggle-grid"><legend>Map detail</legend>{visibleTerrainCategories.map((name) => <label key={name}><input type="checkbox" checked={categories[name]} onChange={(event) => setCategories((value) => ({ ...value, [name]: event.target.checked }))} /><span>{name}</span></label>)}</fieldset>
      </section>

      <section className="side-section">
        <div className="side-heading"><span><small>02</small><strong>Layers</strong></span><small>{map.layers.length}/100</small></div>
        <div className="layer-list">{map.layers.map((layer) => <div className={`layer-row${visibility[layer.id] !== false ? ' visible' : ''}${layerID === layer.id ? ' active' : ''}`} key={layer.id}>
          <label className="layer-select"><input type="radio" name="active-layer" aria-label={layer.name} checked={layerID === layer.id} onChange={() => setLayerID(layer.id)} /><span><i /><b>{layer.name}</b>{layerID === layer.id && <small>Selected</small>}</span></label>
          <label className="layer-visible" title={`${visibility[layer.id] !== false ? 'Hide' : 'Show'} ${layer.name}`}><input type="checkbox" aria-label={`${visibility[layer.id] !== false ? 'Hide' : 'Show'} ${layer.name}`} checked={visibility[layer.id] !== false} onChange={(event) => setVisibility((value) => ({ ...value, [layer.id]: event.target.checked }))} /><span aria-hidden="true">{visibility[layer.id] !== false ? '◉' : '○'}</span></label>
          {manager && <div className="layer-actions"><button title="Rename" aria-label={`Rename ${layer.name}`} onClick={async () => { const name = prompt('Layer name', layer.name); if (name) await api.renameLayer(map.id, layer.id, name) }}>✎</button><button title="Delete" aria-label={`Delete ${layer.name}`} disabled={map.layers.length === 1} onClick={() => api.deleteLayer(map.id, layer.id)}>×</button></div>}
        </div>)}</div>
        <button className="add-layer" onClick={async () => { const name = prompt('Layer name', 'New layer'); if (name) await api.createLayer(map.id, name) }} disabled={map.layers.length >= 100}>＋ Add layer</button>
      </section>

      <section className="side-section annotation-section">
        <div className="side-heading"><span><small>03</small><strong>Draw</strong></span></div>
        <fieldset className="tool-picker"><legend>Tool</legend>{tools.map((tool) => <button type="button" className={activeTool === tool.value ? 'active' : ''} aria-pressed={activeTool === tool.value} aria-keyshortcuts={tool.key.toUpperCase()} disabled={!editing} key={tool.value} onClick={() => setActiveTool((current) => current === tool.value ? null : tool.value)}><b aria-hidden="true">{tool.symbol}</b><span>{tool.label}</span><kbd aria-hidden="true">{tool.key.toUpperCase()}</kbd></button>)}</fieldset>
        <p className={`tool-hint${activeTool ? ' armed' : ''}`}>{!editing ? 'Tools unavailable while offline.' : activeTool === 'pointer' ? 'Point armed · hold mouse to share · Esc to cancel' : activeTool === 'rotate' ? 'Rotate armed · click a marker, then drag its circle · Esc to cancel' : activeTool === 'measure' || activeTool === 'radius' ? `${tools.find(({ value }) => value === activeTool)?.label} armed · click two points · right-click or Esc to cancel` : activeTool ? `${tools.find(({ value }) => value === activeTool)?.label} armed · Esc to cancel` : 'Choose a tool, then use it directly on the map.'}</p>
        {(activeTool === 'polyline' || activeTool === 'freehand' || activeTool === 'measure' || activeTool === 'radius') && <div className="control-grid"><label>Color<select value={color} onChange={(event) => setColor(event.target.value)}>{markerColors.map(([value, name]) => <option value={value} key={value}>{name}</option>)}</select></label></div>}
      </section>
    </aside>

    {world && map.worldAvailable ? <MapCanvas world={world} style={style} categories={categories} annotations={annotations} cursors={collaboration.cursors} editing={editing} activeTool={activeTool} layerID={layerID} color={color} icon={icon} label={label} rotation={rotation} scale={scale} onCreate={collaboration.create} onUpdate={collaboration.update} onDelete={collaboration.remove} onPlaceMarker={setPlacingMarkerAt} onEditMarker={(annotation) => { setActiveTool(null); setPlacingMarkerAt(null); setEditingMarker(annotation) }} onCursor={collaboration.cursor} /> : <section className="missing-world"><span className="empty-crosshair" aria-hidden="true" /><h2>Terrain unavailable</h2><p>Editing is disabled. Export remains available.</p></section>}

    <aside id="notes-panel" className="sidebar notes-panel" aria-label="Map notes" hidden={sidebarTab !== 'notes'}>
      <div className="notes-heading"><h2>Notes</h2><span>{notes.length}</span></div>
      <fieldset className="note-layer-picker"><legend>Layer</legend><div className="layer-list">{map.layers.map((layer) => <div className={`layer-row${visibility[layer.id] !== false ? ' visible' : ''}${layerID === layer.id ? ' active' : ''}`} key={layer.id}>
        <label className="layer-select"><input type="radio" name="note-layer" aria-label={layer.name} checked={layerID === layer.id} onChange={() => setLayerID(layer.id)} disabled={!editing} /><span><i /><b>{layer.name}</b>{layerID === layer.id && <small>Selected</small>}</span></label>
        <label className="layer-visible" title={`${visibility[layer.id] !== false ? 'Hide' : 'Show'} ${layer.name}`}><input type="checkbox" aria-label={`${visibility[layer.id] !== false ? 'Hide' : 'Show'} ${layer.name}`} checked={visibility[layer.id] !== false} onChange={(event) => setVisibility((value) => ({ ...value, [layer.id]: event.target.checked }))} /><span aria-hidden="true">{visibility[layer.id] !== false ? '◉' : '○'}</span></label>
      </div>)}</div></fieldset>
      <form className="note-compose" onSubmit={(event) => { event.preventDefault(); const text = noteText.trim(); if (!text || !activeLayer || visibility[activeLayer.id] === false) return; collaboration.create({ layerId: activeLayer.id, kind: 'note', position: Date.now(), color: 'ColorYellow', text }); setNoteText('') }}>
        <label htmlFor="note-text">Note</label>
        <textarea id="note-text" rows={4} maxLength={1000} value={noteText} onChange={(event) => setNoteText(event.target.value)} placeholder="Orders, timings, radio channels…" disabled={!editing || !activeLayer || visibility[layerID] === false} />
        <button className="primary" disabled={!editing || !activeLayer || visibility[layerID] === false || !noteText.trim()}>Add note</button>
        {visibility[layerID] === false && <small>Show selected layer to add notes.</small>}
      </form>
      <div className="note-list">{notes.length ? notes.map((note) => <article className="note-card" key={note.id}>
        <label className="note-layer">Layer<select aria-label={`Layer for ${note.text}`} value={note.layerId} onChange={(event) => collaboration.update({ ...note, layerId: event.target.value })} disabled={!editing}>{map.layers.map((layer) => <option value={layer.id} key={layer.id}>{layer.name}</option>)}</select></label>
        <p>{note.text}</p>
        <footer><button type="button" disabled={!editing} onClick={() => { const text = prompt('Edit note', note.text); if (text?.trim()) collaboration.update({ ...note, text: text.trim() }) }}>Edit</button><button type="button" className="danger quiet" disabled={!editing} onClick={() => { if (confirm('Delete this note?')) collaboration.remove(note.id) }}>Delete</button></footer>
      </article>) : <p className="notes-empty">No notes on visible layers.</p>}</div>
    </aside>

    {manager && <aside id="settings-panel" className="sidebar settings-panel" aria-label="Map settings" hidden={sidebarTab !== 'settings'}>
      <div className="notes-heading"><h2>Settings</h2></div>
      <section className="settings-section"><h3>Map name</h3><p>{map.name}</p><button onClick={async () => { const name = prompt('Map name', map.name); if (name) await api.renameMap(map.id, name) }}>Rename map</button></section>
      <section className="settings-section danger-zone"><h3>Danger zone</h3><p>Move this map to the administrator trash.</p><button className="danger" onClick={async () => { if (confirm('Move this map to trash?')) { await api.deleteMap(map.id); onBack() } }}>Trash map</button></section>
    </aside>}

    {admin && <aside id="history-panel" className="sidebar history-panel" aria-label="Revision history" hidden={sidebarTab !== 'history'}>
      <div className="notes-heading"><h2>Revision history</h2><button className="icon-button" aria-label="Refresh history" title="Refresh history" onClick={refreshHistory}>↻</button></div>
      <div className="revision-list">{revisions.length > 0 ? revisions.map((revision, index) => { const details = revisionDetails(revision); const deletion = revision.kind === 'annotation.delete'; const undone = deletion && restoredVersions.has(revision.version - 1); return <article className="revision-card" key={revision.id}><header><span className="revision-version">v{revision.version}</span><small>{revision.actor.displayName}</small></header><strong>{details.title}</strong>{details.text && <p className="revision-note">{details.text}</p>}{undone ? <small className="revision-status">Undone</small> : index === 0 && !deletion ? <small className="revision-status">Current</small> : <button onClick={async () => { await api.restore(map.id, deletion ? revision.version - 1 : revision.version); await refreshHistory() }}>{deletion ? 'Undo deletion' : 'Restore this version'}</button>}</article> }) : <p className="history-empty">No revisions found.</p>}</div>
    </aside>}
    {exporting && <ExportDialog mapID={map.id} layers={map.layers} initial={visibleLayerIDs(visibility)} onClose={() => setExporting(false)} />}
    {placingMarkerAt && <MarkerDialog layers={map.layers} initial={{ icon, color, label, rotation, scale, layerID }} onClose={() => setPlacingMarkerAt(null)} onSubmit={(value) => { collaboration.create({ layerId: value.layerID, kind: 'marker', position: Date.now(), color: value.color, point: placingMarkerAt, icon: value.icon, label: value.label, rotation: value.rotation, scale: value.scale }); setIcon(value.icon); setColor(value.color); setLabel(value.label); setRotation(value.rotation); setScale(value.scale); setLayerID(value.layerID); setPlacingMarkerAt(null) }} />}
    {editingMarker && <MarkerDialog editing layers={map.layers} initial={{ icon: editingMarker.icon ?? 'mil_dot', color: editingMarker.color, label: editingMarker.label ?? '', rotation: editingMarker.rotation ?? 0, scale: editingMarker.scale ?? 1, layerID: editingMarker.layerId }} onClose={() => setEditingMarker(null)} onDelete={() => { collaboration.remove(editingMarker.id); setEditingMarker(null) }} onSubmit={(value) => { collaboration.update({ ...editingMarker, icon: value.icon, color: value.color, label: value.label, rotation: value.rotation, scale: value.scale, layerId: value.layerID }); setEditingMarker(null) }} />}
  </main>
}

function StylePreview({ world, style, label, version = 0 }: { world: World; style: string; label: string; version?: number }) {
  const preview = stylePreview(world, style, version)
  return <span className="style-preview"><img key={preview.src} src={preview.src} data-fallback={preview.fallback} alt="" onError={(event) => { const fallback = event.currentTarget.dataset.fallback; if (fallback) { event.currentTarget.dataset.fallback = ''; event.currentTarget.src = fallback } else event.currentTarget.hidden = true }} /><span>{label}</span></span>
}
