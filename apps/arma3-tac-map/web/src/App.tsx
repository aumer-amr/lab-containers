import { useEffect, useState } from 'react'
import { api } from './api'
import { Editor } from './Editor'
import type { TacMap, User, World } from './types'

export function App(){
  const [user,setUser]=useState<User|null|undefined>(undefined)
  const [maps,setMaps]=useState<TacMap[]>([])
  const [worlds,setWorlds]=useState<World[]>([])
  const [trash,setTrash]=useState<TacMap[]>([])
  const [selected,setSelected]=useState<TacMap|null>(null)
  const [error,setError]=useState('')
  const load=()=>Promise.all([api.me(),api.maps(),api.worlds()]).then(async([me,mapList,worldList])=>{setUser(me);setMaps(mapList);setWorlds(worldList);setTrash(me.admin?await api.trash():[])}).catch(()=>setUser(null))
  useEffect(()=>{load()},[])
  if(user===undefined)return <main className="center">Loading…</main>
  if(user===null)return <main className="center"><h1>Arma 3 Tactical Map</h1><p>Discord membership is required.</p><a className="button" href="/auth/login">Sign in with Discord</a></main>
  if(selected){const latest=maps.find(({id})=>id===selected.id)??selected;return <Editor initial={latest} user={user} world={worlds.find(({name})=>name===latest.world)} onBack={()=>{setSelected(null);load()}}/>}
  return <main className="dashboard"><header><div><p className="eyebrow">Collaborative operations planning</p><h1>Tactical maps</h1></div><span>{user.displayName}</span></header>{error&&<p role="alert">{error}</p>}<form className="create" onSubmit={async(event)=>{event.preventDefault();const data=new FormData(event.currentTarget);try{const value=await api.createMap(String(data.get('name')),String(data.get('world')));setMaps((current)=>[...current,value]);setSelected(value)}catch(cause){setError(cause instanceof Error?cause.message:'Create failed')}}}><label>Plan name<input required maxLength={200} name="name"/></label><label>Terrain<select required name="world">{worlds.map((world)=><option value={world.name} key={world.name}>{world.name}</option>)}</select></label><button disabled={!worlds.length}>Create map</button></form><section className="map-grid">{maps.map((map)=><button className="map-card" key={map.id} onClick={async()=>setSelected(await api.map(map.id))}><strong>{map.name}</strong><span>{map.world}</span><span>{map.worldAvailable?'Ready':'Terrain missing'}</span><small>v{map.version} · {map.creator?.displayName}</small></button>)}</section>{!maps.length&&<p>No maps yet.</p>}{user.admin&&trash.length>0&&<section><h2>Trash</h2>{trash.map((map)=><div key={map.id}>{map.name} <button onClick={async()=>{await api.restoreTrash(map.id);load()}}>Restore</button></div>)}</section>}</main>
}
