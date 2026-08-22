import { useEffect, useRef, useState } from 'react'
import { api } from './api'
import { copyText } from './clipboard'
import type { Layer } from './types'

export function ExportDialog({ mapID, layers, initial, onClose }: { mapID: string; layers: Layer[]; initial: string[]; onClose(): void }) {
  const [selected, setSelected] = useState(initial)
  const [output, setOutput] = useState('')
  const [copied, setCopied] = useState<boolean | null>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { api.exportAET(mapID, selected).then(setOutput).catch((error: Error) => setOutput(error.message)) }, [mapID, selected])
  return <dialog open aria-labelledby="export-title" className="dialog">
    <div className="dialog-heading"><span><small>Plan output</small><h2 id="export-title">Export to AET</h2></span><button className="icon-button" aria-label="Close export" onClick={onClose}>×</button></div>
    <p>Select annotation layers to include, then copy the generated plan into AET Plan Importer.</p>
    <fieldset className="export-layers"><legend>Included layers</legend>{layers.map((layer) => <label key={layer.id}><input type="checkbox" checked={selected.includes(layer.id)} onChange={(event) => setSelected((value) => event.target.checked ? [...value, layer.id] : value.filter((id) => id !== layer.id))} /><span>{layer.name}</span></label>)}</fieldset>
    <label className="export-output">Generated plan<textarea ref={textarea} readOnly value={output} rows={16} aria-label="AET export text" /></label>
    <div className="dialog-actions"><span aria-live="polite">{copied === true ? 'Copied to clipboard' : copied === false ? 'Select the text and press Ctrl+C' : ''}</span><button onClick={onClose}>Cancel</button><button className="primary" onClick={async () => setCopied(await copyText(output, () => textarea.current?.select()))}>Copy plan</button></div>
  </dialog>
}
