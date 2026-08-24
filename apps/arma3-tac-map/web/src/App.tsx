import { useEffect, useState } from 'react'
import { AdminTerrains } from './AdminTerrains'
import { api } from './api'
import { Editor } from './Editor'
import type { TacMap, User, World } from './types'

function worldPreviewURL(world?: World) {
  if (!world) return ''
  const base = `/api/worlds/${encodeURIComponent(world.name)}/assets/`
  if (world.preview) return base + encodeURIComponent(world.preview)
  if (world.format !== 'raster') return ''
  const style = world.styles.includes('topo') ? 'topo' : world.styles[0]
  const folder = { topo: '', 'color-relief': 'colorRelief/', 'topo-dark': 'topoDark/', 'topo-relief': 'topoRelief/' }[style]
  return folder === undefined ? '' : `${base}${folder}0/0/0.png`
}

const mapDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })
const mapsPerPage = 10

function mapIDFromPath(pathname: string) {
  const match = pathname.match(/^\/maps\/([^/]+)$/)
  if (!match) return ''
  try { return decodeURIComponent(match[1]) } catch { return '' }
}

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [maps, setMaps] = useState<TacMap[]>([])
  const [worlds, setWorlds] = useState<World[]>([])
  const [trash, setTrash] = useState<TacMap[]>([])
  const [selected, setSelected] = useState<TacMap | null>(null)
  const [adminPage, setAdminPage] = useState(location.pathname === '/admin/maps')
  const [page, setPage] = useState(0)
  const [error, setError] = useState('')
  const openMap = async (id: string, updateURL = true) => {
    const value = await api.map(id)
    if (!value.worldAvailable) { setError('This map cannot be opened because its terrain is unavailable.'); return }
    if (updateURL) history.pushState(null, '', `/maps/${encodeURIComponent(value.id)}`)
    setSelected(value)
  }
  const load = () => Promise.all([api.me(), api.maps(), api.worlds()])
    .then(async ([me, mapList, worldList]) => {
      const wantsAdmin = location.pathname === '/admin/maps'
      const directMapID = mapIDFromPath(location.pathname)
      let directMap: TacMap | null = null
      if (directMapID) {
        try { directMap = await api.map(directMapID) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Map unavailable') }
        if (directMap && !directMap.worldAvailable) { setError('This map cannot be opened because its terrain is unavailable.'); directMap = null }
      }
      setUser(me)
      setMaps(mapList)
      setPage(0)
      setWorlds(worldList)
      setSelected(directMap)
      setTrash(me.admin ? await api.trash() : [])
      if (wantsAdmin && !me.admin) {
        history.replaceState(null, '', '/')
        setAdminPage(false)
        setError('Administrator access is required to manage terrains.')
      } else setAdminPage(wantsAdmin)
    })
    .catch(() => setUser(null))

  useEffect(() => {
    load()
    const navigate = () => load()
    addEventListener('popstate', navigate)
    return () => removeEventListener('popstate', navigate)
  }, [])

  const pageCount = Math.ceil(maps.length / mapsPerPage)
  const pageMaps = maps.slice(page * mapsPerPage, (page + 1) * mapsPerPage)

  if (user === undefined) return <main className="center loading-screen"><span className="brand-mark" aria-hidden="true" /><p>Loading operations workspace…</p></main>
  if (user === null) return <main className="center sign-in-screen">
    <section className="sign-in-card">
      <span className="brand-mark" aria-hidden="true" />
      <p className="eyebrow">Operations workspace</p>
      <h1>Arma 3<br />Tactical Map</h1>
      <p>Plan operations with your unit on a shared, live terrain map.</p>
      <a className="button primary" href={`/auth/login?returnTo=${encodeURIComponent(location.pathname)}`}>Continue with Discord</a>
      <small>Discord unit membership required</small>
    </section>
  </main>
  if (adminPage && user.admin) return <AdminTerrains onBack={() => { history.pushState(null, '', '/'); setAdminPage(false) }} refreshCatalog={async () => {
    const [mapList, worldList, trashList] = await Promise.all([api.maps(), api.worlds(), api.trash()])
    setMaps(mapList); setWorlds(worldList); setTrash(trashList)
  }} />
  if (selected) return <Editor initial={selected} user={user} world={worlds.find(({ name }) => name === selected.world)} onBack={() => { history.pushState(null, '', '/'); setSelected(null); load() }} onTerrainUnavailable={() => { history.pushState(null, '', '/'); setSelected(null); setError('Terrain became unavailable. The editor was closed.'); load() }} />

  return <main className="dashboard">
    <header className="dashboard-header">
      <a className="brand" href="/" aria-label="Arma 3 Tactical Map home"><span className="brand-mark" aria-hidden="true" /><span>Arma 3<strong>Tactical Map</strong></span></a>
      <div className="user-menu">{user.avatar ? <img className="avatar" src={`https://cdn.discordapp.com/avatars/${encodeURIComponent(user.id)}/${encodeURIComponent(user.avatar)}.png?size=64`} alt="" /> : <span className="avatar" aria-hidden="true">{user.displayName.charAt(0).toUpperCase()}</span>}<span><strong>{user.displayName}</strong><small>{user.admin ? 'Administrator' : 'Planner'}</small></span>{user.admin && <button className="sign-out" onClick={() => { history.pushState(null, '', '/admin/maps'); setAdminPage(true) }}>Manage terrains</button>}<button className="sign-out" onClick={async () => { try { await api.logout(); setUser(null) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Sign out failed') } }}>Sign out</button></div>
    </header>

    <section className="dashboard-intro">
      <div><p className="eyebrow">Operations workspace</p><h1>Tactical maps</h1><p>Create a plan or open a shared operation already in progress.</p></div>
      <span className="map-count"><strong>{maps.length}</strong>{maps.length === 1 ? 'active map' : 'active maps'}</span>
    </section>

    {error && <p className="alert" role="alert">{error}</p>}

    <form className="create" onSubmit={async (event) => {
      event.preventDefault()
      const data = new FormData(event.currentTarget)
      try {
        const value = await api.createMap(String(data.get('name')), String(data.get('world')))
        setMaps((current) => [...current, value])
        setSelected(value)
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'Create failed') }
    }}>
      <div className="create-heading"><span className="section-icon" aria-hidden="true">＋</span><span><strong>New tactical map</strong><small>Choose terrain and name the operation.</small></span></div>
      <label>Plan name<input required maxLength={200} name="name" placeholder="e.g. Operation Nightfall" /></label>
      <label>Terrain<select required name="world">{worlds.map((world) => <option value={world.name} key={world.name}>{world.name}</option>)}</select></label>
      <button className="primary" disabled={!worlds.length}>Create map</button>
    </form>

    <div className="section-heading"><div><h2>Maps</h2><p className="section-note">All player-created maps · newest first</p></div></div>
    {maps.length > 0 ? <><section className="map-list" aria-label="Tactical maps">{pageMaps.map((map, index) => {
      const preview = worldPreviewURL(worlds.find(({ name }) => name === map.world))
      const newest = page === 0 && index === 0
      return <button className={`map-row${newest ? ' newest' : ''}`} key={map.id} disabled={!map.worldAvailable} title={map.worldAvailable ? undefined : 'Terrain unavailable'} onClick={() => openMap(map.id)}>
        <span className="map-row-preview">{preview ? <img src={preview} alt={`${map.world} terrain`} /> : <span aria-hidden="true">{map.world.slice(0, 3).toUpperCase()}</span>}</span>
        <span className="map-row-main"><strong>{map.name}</strong><small><span className="terrain-code">{map.world}</span>{newest && <b>Newest</b>}</small></span>
        <span className="map-row-details"><span><small>Created</small><strong>{map.createdAt ? mapDate.format(map.createdAt * 1000) : 'Unknown'} · v{map.version}</strong></span><span><small>Owner</small><strong>{map.creator?.displayName ?? 'Unknown owner'}</strong></span><span className={`status ${map.worldAvailable ? 'ready' : 'missing'}`}><i />{map.worldAvailable ? 'Terrain available' : 'Terrain missing'}</span></span>
        <span className="map-row-arrow" aria-hidden="true">{map.worldAvailable ? '→' : '—'}</span>
      </button>
    })}</section>{pageCount > 1 && <nav className="map-pagination" aria-label="Map pages"><button disabled={page === 0} onClick={() => setPage((value) => value - 1)}>← Previous</button><span>Page {page + 1} of {pageCount}</span><button disabled={page === pageCount - 1} onClick={() => setPage((value) => value + 1)}>Next →</button></nav>}</> : <section className="empty-state"><span className="empty-crosshair" aria-hidden="true" /><h2>No maps yet</h2><p>Create your first tactical map above.</p></section>}

    {user.admin && trash.length > 0 && <section className="trash"><div className="section-heading"><div><p className="eyebrow">Administration</p><h2>Trash</h2></div><span>{trash.length}</span></div>{trash.map((map) => <div className="trash-row" key={map.id}><span><strong>{map.name}</strong><small>{map.world}</small></span><div className="trash-actions"><button disabled={!map.worldAvailable} title={map.worldAvailable ? undefined : 'Terrain is not available'} onClick={async () => { await api.restoreTrash(map.id); load() }}>Restore</button><button className="danger quiet" aria-label={`Delete ${map.name} permanently`} onClick={async () => { if (confirm(`Permanently delete "${map.name}"? This cannot be undone.`)) { await api.purgeTrash(map.id); load() } }}>Delete permanently</button></div></div>)}</section>}
  </main>
}
