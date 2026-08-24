import type { AdminWorld, Revision, TacMap, User, World } from './types'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } })
  if (!response.ok) throw new Error(await response.text() || response.statusText)
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export const api = {
  me: () => request<User>('/api/me'),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  worlds: () => request<World[]>('/api/worlds'),
  adminWorlds: () => request<AdminWorld[]>('/api/admin/worlds'),
  adminWorld: (world: string) => request<AdminWorld>(`/api/admin/worlds/${encodeURIComponent(world)}`),
  uploadWorld: (file: File, progress: (percentage: number) => void) => new Promise<AdminWorld>((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', '/api/admin/worlds')
    request.setRequestHeader('Content-Type', 'application/zip')
    request.upload.onprogress = (event) => { if (event.lengthComputable) progress(Math.round(event.loaded / event.total * 100)) }
    request.onload = () => {
      if (request.status === 201) resolve(JSON.parse(request.responseText) as AdminWorld)
      else reject(new Error(request.responseText || request.statusText))
    }
    request.onerror = () => reject(new Error('Upload failed'))
    request.send(file)
  }),
  deleteWorld: async (world: string, activeMaps: number, trashedMaps: number) => {
    const response = await fetch(`/api/admin/worlds/${encodeURIComponent(world)}`, { method: 'DELETE', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activeMaps, trashedMaps }) })
    if (response.status === 409) return response.json() as Promise<AdminWorld>
    if (!response.ok) throw new Error(await response.text() || response.statusText)
    return undefined
  },
  completeWorldPreviews: (world: string) => request<AdminWorld>(`/api/admin/worlds/${encodeURIComponent(world)}/previews/complete`, { method: 'POST' }),
  saveWorldPreview: async (world: string, style: string, preview: Blob) => {
    const response = await fetch(`/api/worlds/${encodeURIComponent(world)}/previews/${encodeURIComponent(style)}`, { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'image/png' }, body: preview })
    if (!response.ok) throw new Error(await response.text() || response.statusText)
  },
  maps: () => request<TacMap[]>('/api/maps'),
  trash: () => request<TacMap[]>('/api/trash'),
  map: (id: string) => request<TacMap>(`/api/maps/${id}`),
  createMap: (name: string, world: string) => request<TacMap>('/api/maps', { method: 'POST', body: JSON.stringify({ name, world }) }),
  renameMap: (id: string, name: string) => request<TacMap>(`/api/maps/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteMap: (id: string) => request<void>(`/api/maps/${id}`, { method: 'DELETE' }),
  restoreTrash: (id: string) => request<TacMap>(`/api/maps/${id}/trash/restore`, { method: 'POST' }),
  purgeTrash: (id: string) => request<void>(`/api/trash/${id}`, { method: 'DELETE' }),
  createLayer: (map: string, name: string) => request(`/api/maps/${map}/layers`, { method: 'POST', body: JSON.stringify({ name }) }),
  renameLayer: (map: string, layer: string, name: string) => request(`/api/maps/${map}/layers/${layer}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteLayer: (map: string, layer: string) => request<void>(`/api/maps/${map}/layers/${layer}`, { method: 'DELETE' }),
  reorderLayers: (map: string, layerIds: string[]) => request(`/api/maps/${map}/layers/order`, { method: 'PUT', body: JSON.stringify({ layerIds }) }),
  revisions: (map: string) => request<Revision[]>(`/api/maps/${map}/revisions`),
  restore: (map: string, revision: number) => request<TacMap>(`/api/maps/${map}/revisions/${revision}/restore`, { method: 'POST' }),
  exportAET: async (map: string, layerIds: string[]) => {
    const response = await fetch(`/api/maps/${map}/exports/aet`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ layerIds }) })
    if (!response.ok) throw new Error(await response.text())
    return response.text()
  },
}
