import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { App } from './App'
import type { TacMap, User, World } from './types'

const api = vi.hoisted(() => ({
  me: vi.fn(),
  maps: vi.fn(),
  worlds: vi.fn(),
  adminWorlds: vi.fn(),
  adminWorld: vi.fn(),
  uploadWorld: vi.fn(),
  deleteWorld: vi.fn(),
  saveWorldPreview: vi.fn(),
  completeWorldPreviews: vi.fn(),
  trash: vi.fn(),
  restoreTrash: vi.fn(),
  purgeTrash: vi.fn(),
  map: vi.fn(),
  logout: vi.fn(),
}))
const previewRenderer = vi.hoisted(() => vi.fn())

vi.mock('./api', () => ({ api }))
vi.mock('./MapCanvas', () => ({ renderStylePreview: previewRenderer }))
vi.mock('./Editor', () => ({ Editor: ({ initial, onBack, onTerrainUnavailable }: { initial: TacMap; onBack(): void; onTerrainUnavailable(): void }) => <><p>Layers: {initial.layers.length}</p><button onClick={onBack}>Back to maps</button><button onClick={onTerrainUnavailable}>Terrain removed</button></> }))

const user: User = { id: 'owner', username: 'owner', displayName: 'Owner', admin: false }
const world: World = { name: 'altis', size: 100, styles: ['default'], format: 'pmtiles', hasMeta: false }
const fullMap: TacMap = { id: 'map', name: 'Plan', world: world.name, creatorId: user.id, creator: user, version: 1, deleted: false, worldAvailable: true, layers: [{ id: 'general', mapId: 'map', name: 'General', position: 0 }] }

beforeEach(() => {
  vi.clearAllMocks()
  history.replaceState(null, '', '/')
  const listedMap = { ...fullMap } as Partial<TacMap>
  delete listedMap.layers
  api.me.mockResolvedValue(user)
  api.maps.mockResolvedValue([listedMap])
  api.worlds.mockResolvedValue([world])
  api.map.mockResolvedValue(fullMap)
  api.trash.mockResolvedValue([])
  api.adminWorlds.mockResolvedValue([])
  api.saveWorldPreview.mockResolvedValue(undefined)
  api.completeWorldPreviews.mockResolvedValue(undefined)
  previewRenderer.mockResolvedValue(new Blob(['png'], { type: 'image/png' }))
})

afterEach(cleanup)

it('opens a map with the hydrated snapshot instead of its shallow list entry', async () => {
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: /Plan/ }))
  expect(await screen.findByText('Layers: 1')).toBeInTheDocument()
  expect(location.pathname).toBe('/maps/map')
})

it('opens a linked map directly and returns to it after login', async () => {
  history.replaceState(null, '', '/maps/map')
  render(<App />)
  expect(await screen.findByText('Layers: 1')).toBeInTheDocument()
  expect(api.map).toHaveBeenCalledWith('map')
})

it('preserves a linked map path when login is required', async () => {
  history.replaceState(null, '', '/maps/map')
  api.me.mockRejectedValue(new Error('authentication required'))
  render(<App />)
  expect(await screen.findByRole('link', { name: 'Continue with Discord' })).toHaveAttribute('href', '/auth/login?returnTo=%2Fmaps%2Fmap')
})

it('logs out through the API and returns to sign in', async () => {
  api.logout.mockResolvedValue(undefined)
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
  expect(api.logout).toHaveBeenCalledOnce()
  expect(await screen.findByRole('link', { name: 'Continue with Discord' })).toBeInTheDocument()
})

it('shows the Discord avatar when available', async () => {
  api.me.mockResolvedValue({ ...user, avatar: 'avatar-hash' })
  const { container } = render(<App />)
  await screen.findByRole('button', { name: 'Sign out' })
  expect(container.querySelector('img.avatar')).toHaveAttribute('src', 'https://cdn.discordapp.com/avatars/owner/avatar-hash.png?size=64')
})

it('shows each map as a compact row with its terrain preview', async () => {
  api.worlds.mockResolvedValue([{ ...world, preview: 'preview.png' }])
  const { container } = render(<App />)
  expect(await screen.findByRole('img', { name: 'altis terrain' })).toHaveAttribute('src', '/api/worlds/altis/assets/preview.png')
  expect(container.querySelector('.map-row')).toBeInTheDocument()
  expect(container.querySelector('.map-card')).not.toBeInTheDocument()
})

it('uses the complete zoom-zero tile when a raster world has no preview', async () => {
  api.worlds.mockResolvedValue([{ ...world, format: 'raster', styles: ['color-relief', 'topo'], maxZoom: 7 }])
  render(<App />)
  expect(await screen.findByRole('img', { name: 'altis terrain' })).toHaveAttribute('src', '/api/worlds/altis/assets/0/0/0.png')
})

it('does not open a map when its terrain is unavailable', async () => {
  api.maps.mockResolvedValue([{ ...fullMap, worldAvailable: false }])
  render(<App />)
  const row = await screen.findByRole('button', { name: /Plan/ })
  expect(row).toBeDisabled()
  fireEvent.click(row)
  expect(api.map).not.toHaveBeenCalled()
})

it('shows ten maps per dashboard page', async () => {
  api.maps.mockResolvedValue(Array.from({ length: 11 }, (_, index) => ({ ...fullMap, id: `map-${index + 1}`, name: `Plan ${index + 1}` })))
  render(<App />)
  expect(await screen.findByText('Plan 1')).toBeInTheDocument()
  expect(screen.queryByText('Plan 11')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Next →' }))
  expect(await screen.findByText('Plan 11')).toBeInTheDocument()
  expect(screen.getByText('Page 2 of 2')).toBeInTheDocument()
})

it('lets admins permanently delete a trashed map after confirmation', async () => {
  api.me.mockResolvedValue({ ...user, admin: true })
  api.trash.mockResolvedValue([{ ...fullMap, deleted: true }])
  api.purgeTrash.mockResolvedValue(undefined)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: 'Delete Plan permanently' }))
  expect(window.confirm).toHaveBeenCalledWith('Permanently delete "Plan"? This cannot be undone.')
  expect(api.purgeTrash).toHaveBeenCalledWith('map')
})

it('shows but disables restore when a trashed map terrain is unavailable', async () => {
  api.me.mockResolvedValue({ ...user, admin: true })
  api.trash.mockResolvedValue([{ ...fullMap, deleted: true, worldAvailable: false }])
  render(<App />)
  const restore = await screen.findByRole('button', { name: 'Restore' })
  expect(restore).toBeDisabled()
  expect(restore).toHaveAttribute('title', 'Terrain is not available')
  fireEvent.click(restore)
  expect(api.restoreTrash).not.toHaveBeenCalled()
})

it('redirects non-admin direct terrain navigation with an access error', async () => {
  history.replaceState(null, '', '/admin/maps')
  render(<App />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Administrator access is required')
  expect(location.pathname).toBe('/')
  expect(api.adminWorlds).not.toHaveBeenCalled()
})

it('shows terrain management only to admins', async () => {
  render(<App />)
  expect(await screen.findByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Manage terrains' })).not.toBeInTheDocument()
  cleanup()
  api.me.mockResolvedValue({ ...user, admin: true })
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: 'Manage terrains' }))
  expect(await screen.findByRole('heading', { name: 'Terrain files' })).toBeInTheDocument()
  expect(location.pathname).toBe('/admin/maps')
})

it('loads fresh terrain counts and confirms deletion accessibly', async () => {
  const terrain = { name: 'altis', valid: true, validationError: '', format: 'pmtiles', styles: ['topo'], activeMaps: 2, trashedMaps: 1, ready: true, size: 100 }
  history.replaceState(null, '', '/admin/maps')
  api.me.mockResolvedValue({ ...user, admin: true })
  api.adminWorlds.mockResolvedValue([terrain])
  api.adminWorld.mockResolvedValue(terrain)
  api.deleteWorld.mockResolvedValue(undefined)
  render(<App />)
  const trigger = await screen.findByRole('button', { name: 'Delete' })
  fireEvent.click(trigger)
  expect(api.adminWorld).toHaveBeenCalledWith('altis')
  expect(await screen.findByText('This cannot be undone.', { exact: false })).toBeInTheDocument()
  const cancel = await screen.findByRole('button', { name: 'Cancel' })
  expect(cancel).toHaveFocus()
  fireEvent.click(cancel)
  expect(trigger).toHaveFocus()
  fireEvent.click(trigger)
  fireEvent.click(await screen.findByRole('button', { name: 'Delete terrain' }))
  expect(api.deleteWorld).toHaveBeenCalledWith('altis', 2, 1)
  await waitFor(() => expect(api.trash).toHaveBeenCalledTimes(2))
})

it('refreshes stale delete counts and requires confirmation again', async () => {
  const terrain = { name: 'altis', valid: true, validationError: '', format: 'pmtiles', styles: ['topo'], activeMaps: 1, trashedMaps: 0, ready: true, size: 100 }
  history.replaceState(null, '', '/admin/maps')
  api.me.mockResolvedValue({ ...user, admin: true })
  api.adminWorlds.mockResolvedValue([terrain])
  api.adminWorld.mockResolvedValue(terrain)
  api.deleteWorld.mockResolvedValueOnce({ ...terrain, activeMaps: 2 })
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Delete terrain' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Map counts changed')
  expect(screen.getByText('2')).toBeInTheDocument()
  expect(api.deleteWorld).toHaveBeenCalledOnce()
})

it('renders upload errors as text', async () => {
  history.replaceState(null, '', '/admin/maps')
  api.me.mockResolvedValue({ ...user, admin: true })
  api.uploadWorld.mockRejectedValue(new Error('<b>unsafe archive</b>'))
  render(<App />)
  const input = await screen.findByLabelText('ZIP file')
  fireEvent.change(input, { target: { files: [new File(['zip'], 'bad.zip', { type: 'application/zip' })] } })
  fireEvent.submit(input.closest('form')!)
  expect(await screen.findByRole('alert')).toHaveTextContent('<b>unsafe archive</b>')
  expect(document.querySelector('.alert b')).toBeNull()
})

it('shows validating state after upload reaches 100 percent', async () => {
  history.replaceState(null, '', '/admin/maps')
  api.me.mockResolvedValue({ ...user, admin: true })
  let finish: ((value: unknown) => void) | undefined
  api.uploadWorld.mockImplementation((_file, progress) => { progress(100); return new Promise((resolve) => { finish = resolve }) })
  render(<App />)
  const input = await screen.findByLabelText('ZIP file')
  fireEvent.change(input, { target: { files: [new File(['zip'], 'altis.zip', { type: 'application/zip' })] } })
  fireEvent.submit(input.closest('form')!)
  expect(await screen.findByText('Validating and installing…')).toBeInTheDocument()
  await act(async () => finish?.({ name: 'altis', valid: true, validationError: '', format: 'raster', styles: ['topo'], activeMaps: 0, trashedMaps: 0, ready: true, size: 100 }))
})

it('generates every vector preview before completing terrain upload', async () => {
  history.replaceState(null, '', '/admin/maps')
  api.me.mockResolvedValue({ ...user, admin: true })
  const terrain = { name: 'altis', valid: true, validationError: '', format: 'pmtiles', styles: ['topo', 'dark'], activeMaps: 0, trashedMaps: 0, ready: false, size: 100 }
  api.uploadWorld.mockResolvedValue(terrain)
  render(<App />)
  const input = await screen.findByLabelText('ZIP file')
  fireEvent.change(input, { target: { files: [new File(['zip'], 'altis.zip', { type: 'application/zip' })] } })
  fireEvent.submit(input.closest('form')!)
  await waitFor(() => expect(api.completeWorldPreviews).toHaveBeenCalledWith('altis'))
  expect(previewRenderer).toHaveBeenCalledTimes(2)
  expect(api.saveWorldPreview).toHaveBeenNthCalledWith(1, 'altis', 'topo', expect.any(Blob))
  expect(api.saveWorldPreview).toHaveBeenNthCalledWith(2, 'altis', 'dark', expect.any(Blob))
  expect(api.completeWorldPreviews.mock.invocationCallOrder[0]).toBeGreaterThan(api.saveWorldPreview.mock.invocationCallOrder[1])
})

it('leaves editor with a clear message when terrain disappears', async () => {
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: /Plan/ }))
  fireEvent.click(await screen.findByRole('button', { name: 'Terrain removed' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Terrain became unavailable')
  expect(location.pathname).toBe('/')
})
