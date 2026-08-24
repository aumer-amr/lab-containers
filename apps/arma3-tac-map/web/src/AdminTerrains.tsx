import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import { renderStylePreview } from './MapCanvas'
import type { AdminWorld, World } from './types'

export function AdminTerrains({ onBack, refreshCatalog }: { onBack(): void; refreshCatalog(): Promise<void> }) {
  const [terrains, setTerrains] = useState<AdminWorld[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [operation, setOperation] = useState<'upload' | 'previews' | 'delete' | null>(null)
  const [progress, setProgress] = useState(0)
  const [previewProgress, setPreviewProgress] = useState({ done: 0, total: 0 })
  const [selected, setSelected] = useState<AdminWorld | null>(null)
  const [loadingDelete, setLoadingDelete] = useState('')
  const [error, setError] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const deleteTrigger = useRef<HTMLButtonElement | null>(null)
  const load = () => api.adminWorlds().then(setTerrains).catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not load terrains'))

  useEffect(() => { void load() }, [])
  useEffect(() => {
    if (!selected) return
    if (!dialog.current?.open) dialog.current?.showModal()
    cancel.current?.focus()
    return () => deleteTrigger.current?.focus()
  }, [selected])

  const closeDialog = () => { dialog.current?.close(); setSelected(null) }
  const refresh = async () => { await Promise.all([load(), refreshCatalog()]) }
  const generatePreviews = async (terrain: AdminWorld) => {
    if (terrain.ready) return
    if (terrain.format !== 'pmtiles' || !terrain.size || !terrain.styles?.length) throw new Error('Terrain preview metadata is incomplete')
    setOperation('previews')
    setPreviewProgress({ done: 0, total: terrain.styles.length })
    const world: World = { name: terrain.name, size: terrain.size, format: terrain.format, styles: terrain.styles, hasMeta: false }
    for (const [index, style] of terrain.styles.entries()) {
      await api.saveWorldPreview(terrain.name, style, await renderStylePreview(world, style))
      setPreviewProgress({ done: index + 1, total: terrain.styles.length })
    }
    await api.completeWorldPreviews(terrain.name)
  }

  return <main className="dashboard admin-terrains">
    <header className="dashboard-header">
      <button className="back-button" onClick={onBack}>← Maps</button>
      <span className="terrain-admin-label">Administrator</span>
    </header>
    <section className="dashboard-intro">
      <div><p className="eyebrow">Administration</p><h1>Terrain files</h1><p>Install or permanently delete complete terrain asset bundles.</p></div>
      <span className="map-count"><strong>{terrains.length}</strong>{terrains.length === 1 ? 'terrain' : 'terrains'}</span>
    </section>
    {error && !selected && <p className="alert" role="alert">{error}</p>}
    <form className="terrain-upload" onSubmit={async (event) => {
      event.preventDefault()
      if (!file) return
      const form = event.currentTarget
      setError(''); setOperation('upload'); setProgress(0)
      try {
        const terrain = await api.uploadWorld(file, setProgress)
        setFile(null)
        const input = form.elements.namedItem('terrain') as HTMLInputElement
        input.value = ''
        await generatePreviews(terrain)
        await refresh()
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'Upload failed'); await load() }
      finally { setOperation(null) }
    }}>
      <div><strong>Upload terrain ZIP</strong><small>One top-level directory containing map.json and all terrain assets.</small></div>
      <label>ZIP file<input name="terrain" type="file" required accept=".zip,application/zip" disabled={operation !== null} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
      <button className="primary" disabled={!file || operation !== null}>Upload</button>
      {operation === 'upload' && <div className="upload-progress" role="status" aria-live="polite"><progress max="100" value={progress} /><span>{progress < 100 ? `Uploading… ${progress}%` : 'Validating and installing…'}</span></div>}
      {operation === 'previews' && <div className="upload-progress" role="status" aria-live="polite"><progress max={previewProgress.total} value={previewProgress.done} /><span>Generating previews… {previewProgress.done}/{previewProgress.total}</span></div>}
    </form>
    <div className="section-heading"><div><h2>Installed terrains</h2><p className="section-note">Valid and malformed safe-named directories under the terrain volume.</p></div></div>
    <section className="terrain-list" aria-label="Installed terrains">
      {terrains.map((terrain) => <article className="terrain-row" key={terrain.name}>
        <span><strong>{terrain.name}</strong><small className={terrain.valid && terrain.ready ? 'valid' : 'invalid'}>{!terrain.valid ? terrain.validationError : terrain.ready ? `${terrain.format} · ${terrain.styles?.join(', ')}` : 'Preview generation pending · terrain unavailable'}</small></span>
        <span><small>Active maps</small><strong>{terrain.activeMaps}</strong></span>
        <span><small>Trashed maps</small><strong>{terrain.trashedMaps}</strong></span>
        <div className="terrain-actions">{terrain.valid && !terrain.ready && <button disabled={operation !== null || loadingDelete !== ''} onClick={async () => {
          setError('')
          try { await generatePreviews(terrain); await refresh() }
          catch (cause) { setError(cause instanceof Error ? cause.message : 'Preview generation failed') }
          finally { setOperation(null) }
        }}>Generate previews</button>}<button className="danger" disabled={operation !== null || loadingDelete !== ''} onClick={async (event) => {
          deleteTrigger.current = event.currentTarget
          setError(''); setLoadingDelete(terrain.name)
          try { setSelected(await api.adminWorld(terrain.name)) }
          catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load terrain') }
          finally { setLoadingDelete('') }
        }}>{loadingDelete === terrain.name ? 'Loading…' : 'Delete'}</button></div>
      </article>)}
      {!terrains.length && <p className="terrain-empty">No terrain directories found.</p>}
    </section>
    {selected && <dialog className="dialog terrain-delete-dialog" ref={dialog} onCancel={(event) => { event.preventDefault(); closeDialog() }}>
      <div className="dialog-heading"><div><small>Permanent action</small><h2>Delete terrain?</h2></div></div>
      {error && <p className="alert" role="alert">{error}</p>}
      <p>Delete terrain <strong>{selected.name}</strong>? This cannot be undone. Active tactical maps using this terrain will be moved to trash, and generated previews will be deleted.</p>
      <dl><div><dt>Active maps</dt><dd>{selected.activeMaps}</dd></div><div><dt>Trashed maps</dt><dd>{selected.trashedMaps}</dd></div></dl>
      <div className="dialog-actions">
        <button ref={cancel} disabled={operation !== null} onClick={closeDialog}>Cancel</button>
        <button className="danger" disabled={operation !== null} onClick={async () => {
          setError(''); setOperation('delete')
          try {
            const changed = await api.deleteWorld(selected.name, selected.activeMaps, selected.trashedMaps)
            if (changed) { setSelected(changed); setError('Map counts changed. Review the updated counts and confirm again.') }
            else { closeDialog(); await refresh() }
          } catch (cause) { setError(cause instanceof Error ? cause.message : 'Delete failed') }
          finally { setOperation(null) }
        }}>{operation === 'delete' ? 'Deleting…' : 'Delete terrain'}</button>
      </div>
    </dialog>}
  </main>
}
