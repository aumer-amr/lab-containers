import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { App } from './App'
import type { TacMap, User, World } from './types'

const api = vi.hoisted(() => ({
  me: vi.fn(),
  maps: vi.fn(),
  worlds: vi.fn(),
  trash: vi.fn(),
  restoreTrash: vi.fn(),
  purgeTrash: vi.fn(),
  map: vi.fn(),
  logout: vi.fn(),
}))

vi.mock('./api', () => ({ api }))
vi.mock('./Editor', () => ({ Editor: ({ initial, onBack }: { initial: TacMap; onBack(): void }) => <><p>Layers: {initial.layers.length}</p><button onClick={onBack}>Back to maps</button></> }))

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
