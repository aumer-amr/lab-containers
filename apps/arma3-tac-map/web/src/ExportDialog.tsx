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
    <h2 id="export-title">AET export</h2>
    <fieldset><legend>Layers</legend>{layers.map((layer) => <label key={layer.id}><input type="checkbox" checked={selected.includes(layer.id)} onChange={(event) => setSelected((value) => event.target.checked ? [...value, layer.id] : value.filter((id) => id !== layer.id))} />{layer.name}</label>)}</fieldset>
    <textarea ref={textarea} readOnly value={output} rows={16} aria-label="AET export text" />
    <div className="dialog-actions"><button onClick={async () => setCopied(await copyText(output, () => textarea.current?.select()))}>Copy</button><button onClick={onClose}>Close</button></div>
    {copied === false && <p>Select-text fallback active. Press Ctrl+C.</p>}
  </dialog>
}
