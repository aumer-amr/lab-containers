import { useEffect, useMemo, useState } from 'react'
import { api } from './api'
import { useCollaboration } from './collaboration'
import { ExportDialog } from './ExportDialog'
import { MapCanvas } from './MapCanvas'
import { canManageMap, canRestore, editingEnabled, flattenAnnotations, initialVisibility, visibleLayerIDs } from './state'
import type { Revision, TacMap, User, World } from './types'

const colors = ['ColorBlack','ColorGrey','ColorRed','ColorBrown','ColorOrange','ColorYellow','ColorKhaki','ColorGreen','ColorBlue','ColorPink','ColorWhite','ColorUNKNOWN','colorBLUFOR','colorOPFOR','colorIndependent','colorCivilian']
const icons = ['mil_dot','mil_objective','mil_warning','mil_start','mil_end','mil_pickup','mil_destroy','mil_ambush','mil_arrow','mil_circle','mil_box','mil_triangle','mil_flag','mil_unknown']
const terrainCategories = ['terrain','roads','buildings','vegetation','labels']

export function Editor({ initial, user, world, onBack }: { initial: TacMap; user: User; world?: World; onBack(): void }) {
  const collaboration = useCollaboration(initial.id, initial)
  const map = collaboration.map ?? initial
  const [visibility, setVisibility] = useState(() => initialVisibility(initial.layers))
  const [style, setStyle] = useState(world?.styles[0] ?? '')
  const [categories, setCategories] = useState<Record<string, boolean>>(() => Object.fromEntries(terrainCategories.map((name) => [name, true])))
  const [layerID, setLayerID] = useState(initial.layers[0]?.id ?? '')
  const [kind, setKind] = useState<'marker'|'polyline'|'freehand'>('marker')
  const [color, setColor] = useState('ColorBlack')
  const [icon, setIcon] = useState('mil_dot')
  const [label, setLabel] = useState('')
  const [rotation, setRotation] = useState(0)
  const [scale, setScale] = useState(1)
  const [exporting, setExporting] = useState(false)
  const [revisions, setRevisions] = useState<Revision[]>([])
  useEffect(() => { setVisibility((current) => ({ ...initialVisibility(map.layers), ...current })); if (!map.layers.some(({ id }) => id === layerID)) setLayerID(map.layers[0]?.id ?? '') }, [map.layers, layerID])
  const manager = canManageMap(user,map)
  const annotations = useMemo(() => flattenAnnotations(map.layers,visibility),[map.layers,visibility])
  const editing = editingEnabled(collaboration.connected,map)
  const refreshHistory = () => api.revisions(map.id).then(setRevisions)

  return <main className="editor-shell">
    <header className="editor-header"><button onClick={onBack}>Maps</button><h1>{map.name}</h1><span className={collaboration.connected?'online':'offline'}>{collaboration.connected?'Connected':'Disconnected'}</span>{manager&&<><button onClick={async()=>{const name=prompt('Map name',map.name);if(name)await api.renameMap(map.id,name)}}>Rename map</button><button className="danger" onClick={async()=>{if(confirm('Move this map to trash?')){await api.deleteMap(map.id);onBack()}}}>Trash</button></>}<button onClick={()=>setExporting(true)}>Export</button><button onClick={()=>{refreshHistory();document.getElementById('history')?.scrollIntoView()}}>History</button></header>
    <aside className="sidebar">
      <h2>View</h2>
      {world&&<label>Terrain style<select value={style} onChange={(event)=>setStyle(event.target.value)}>{world.styles.map((name)=><option key={name}>{name}</option>)}</select></label>}
      <fieldset><legend>Terrain categories</legend>{terrainCategories.map((name)=><label key={name}><input type="checkbox" checked={categories[name]} onChange={(event)=>setCategories((value)=>({...value,[name]:event.target.checked}))}/>{name}</label>)}</fieldset>
      <fieldset><legend>Annotation layers</legend>{map.layers.map((layer,index)=><div className="layer-row" key={layer.id}><label><input type="checkbox" checked={visibility[layer.id]!==false} onChange={(event)=>setVisibility((value)=>({...value,[layer.id]:event.target.checked}))}/>{layer.name}</label>{manager&&<><button aria-label={`Move ${layer.name} up`} disabled={index===0} onClick={()=>{const ids=map.layers.map(({id})=>id);[ids[index-1],ids[index]]=[ids[index],ids[index-1]];api.reorderLayers(map.id,ids)}}>↑</button><button aria-label={`Move ${layer.name} down`} disabled={index===map.layers.length-1} onClick={()=>{const ids=map.layers.map(({id})=>id);[ids[index+1],ids[index]]=[ids[index],ids[index+1]];api.reorderLayers(map.id,ids)}}>↓</button><button aria-label={`Rename ${layer.name}`} onClick={async()=>{const name=prompt('Layer name',layer.name);if(name)await api.renameLayer(map.id,layer.id,name)}}>✎</button><button aria-label={`Delete ${layer.name}`} disabled={map.layers.length===1} onClick={()=>api.deleteLayer(map.id,layer.id)}>×</button></>}</div>)}<button onClick={async()=>{const name=prompt('Layer name','New layer');if(name)await api.createLayer(map.id,name)}} disabled={map.layers.length>=100}>Add layer</button></fieldset>
      <h2>New annotation</h2>
      <label>Layer<select value={layerID} onChange={(event)=>setLayerID(event.target.value)}>{map.layers.map((layer)=><option value={layer.id} key={layer.id}>{layer.name}</option>)}</select></label>
      <label>Tool<select value={kind} onChange={(event)=>setKind(event.target.value as typeof kind)}><option value="marker">Marker</option><option value="polyline">Polyline</option><option value="freehand">Freehand stroke</option></select></label>
      <label>Color<select value={color} onChange={(event)=>setColor(event.target.value)}>{colors.map((value)=><option key={value}>{value}</option>)}</select></label>
      {kind==='marker'&&<><label>Icon<select value={icon} onChange={(event)=>setIcon(event.target.value)}>{icons.map((value)=><option key={value}>{value}</option>)}</select></label><label>Label<input maxLength={200} value={label} onChange={(event)=>setLabel(event.target.value)}/></label><label>Rotation<input type="number" value={rotation} onChange={(event)=>setRotation(Number(event.target.value))}/></label><label>Scale<input type="number" min="0.1" step="0.1" value={scale} onChange={(event)=>setScale(Number(event.target.value))}/></label></>}
    </aside>
    {world&&map.worldAvailable?<MapCanvas world={world} style={style} categories={categories} annotations={annotations} cursors={collaboration.cursors} editing={editing} layerID={layerID} kind={kind} color={color} icon={icon} label={label} rotation={rotation} scale={scale} onCreate={collaboration.create} onUpdate={collaboration.update} onDelete={collaboration.remove} onCursor={collaboration.cursor}/>:<section className="missing-world"><h2>Terrain unavailable</h2><p>Editing is disabled. Export and revision history remain available.</p></section>}
    <section id="history" className="history"><h2>Revision history</h2><button onClick={refreshHistory}>Refresh</button>{revisions.map((revision)=><div key={revision.id}><span>v{revision.version} · {revision.kind} · {revision.actor.displayName}</span>{canRestore(user)&&<button onClick={()=>api.restore(map.id,revision.version)}>Restore</button>}</div>)}</section>
    {exporting&&<ExportDialog mapID={map.id} layers={map.layers} initial={visibleLayerIDs(visibility)} onClose={()=>setExporting(false)}/>}
  </main>
}
