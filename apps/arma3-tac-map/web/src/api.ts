import type { Revision, TacMap, User, World } from './types'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } })
  if (!response.ok) throw new Error(await response.text() || response.statusText)
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export const api = {
  me: () => request<User>('/api/me'),
  worlds: () => request<World[]>('/api/worlds'),
  maps: () => request<TacMap[]>('/api/maps'),
  trash: () => request<TacMap[]>('/api/trash'),
  map: (id: string) => request<TacMap>(`/api/maps/${id}`),
  createMap: (name: string, world: string) => request<TacMap>('/api/maps', { method: 'POST', body: JSON.stringify({ name, world }) }),
  renameMap: (id: string, name: string) => request<TacMap>(`/api/maps/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteMap: (id: string) => request<void>(`/api/maps/${id}`, { method: 'DELETE' }),
  restoreTrash: (id: string) => request<TacMap>(`/api/maps/${id}/trash/restore`, { method: 'POST' }),
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
