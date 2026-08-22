import { useEffect, useRef, useState, type FormEvent } from 'react'
import { markerColors, markerImageURL, markerShapes } from './markers'
import type { Layer } from './types'

export type MarkerSettings = { icon: string; color: string; rotation: number; label: string; scale: number; layerID: string }

export function MarkerDialog({ initial, layers, editing = false, onClose, onSubmit, onDelete }: { initial: MarkerSettings; layers: Layer[]; editing?: boolean; onClose(): void; onSubmit(value: MarkerSettings): void; onDelete?(): void }) {
  const [value, setValue] = useState(initial)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { if (dialog.current?.showModal) dialog.current.showModal(); else dialog.current?.setAttribute('open', '') }, [])
  const submit = (event: FormEvent) => { event.preventDefault(); onSubmit(value) }
  return <dialog ref={dialog} onCancel={onClose} aria-labelledby="marker-title" className="dialog marker-dialog">
    <form onSubmit={submit}>
      <div className="dialog-heading"><span><small>{editing ? 'Marker properties' : 'Drawing tool'}</small><h2 id="marker-title">{editing ? 'Edit marker' : 'Place marker'}</h2></span><button type="button" className="icon-button" aria-label="Close marker settings" onClick={onClose}>×</button></div>
      <fieldset className="marker-shapes"><legend>Shape</legend>{markerShapes.map(([icon, name]) => <label key={icon} title={name}><input type="radio" name="marker-shape" value={icon} checked={value.icon === icon} onChange={() => setValue({ ...value, icon })} /><span><img src={markerImageURL(icon, value.color)} alt="" /><small>{name}</small></span></label>)}</fieldset>
      <fieldset className="marker-colors"><legend>Color</legend>{markerColors.map(([color, name]) => <label key={color} title={name}><input type="radio" name="marker-color" value={color} checked={value.color === color} onChange={() => setValue({ ...value, color })} /><span><img src={markerImageURL('mil_dot', color)} alt="" /><small>{name}</small></span></label>)}</fieldset>
      <div className="marker-options">
        <label>Rotation<input aria-label="Rotation" type="number" min="0" max="360" step="1" value={value.rotation} onChange={(event) => setValue({ ...value, rotation: Number(event.target.value) })} /></label>
        <label className="marker-label">Label<input maxLength={200} value={value.label} placeholder="Optional callsign" onChange={(event) => setValue({ ...value, label: event.target.value })} /></label>
        <label>Scale<input aria-label="Scale" type="number" min="10" max="1000" step="10" value={Math.round(value.scale * 100)} onChange={(event) => setValue({ ...value, scale: Number(event.target.value) / 100 })} /><small>percent</small></label>
        <label>Layer<select value={value.layerID} onChange={(event) => setValue({ ...value, layerID: event.target.value })}>{layers.map((layer) => <option value={layer.id} key={layer.id}>{layer.name}</option>)}</select></label>
      </div>
      <div className="dialog-actions">{onDelete && <button className="danger delete-action" type="button" onClick={onDelete}>Delete marker</button>}<button type="button" onClick={onClose}>Cancel</button><button className="primary" type="submit">{editing ? 'Save changes' : 'Place marker'}</button></div>
    </form>
  </dialog>
}
