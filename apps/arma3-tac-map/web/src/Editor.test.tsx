import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { api } from './api'
import { Editor } from './Editor'
import type { Revision, TacMap, User, World } from './types'

const collaboration = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), remove: vi.fn() }))
const previewRenderer = vi.hoisted(() => vi.fn())

vi.mock('./MapCanvas', () => ({
  MapCanvas: ({ activeTool, onPlaceMarker, onEditMarker }: { activeTool: string | null; onPlaceMarker(point: [number, number]): void; onEditMarker(annotation: unknown): void }) => <><p>Active tool: {activeTool ?? 'none'}</p><button onClick={() => onPlaceMarker([25, 35])}>Click map for marker</button><button onClick={() => onEditMarker({ id: 'placed', mapId: 'map', layerId: 'general', kind: 'marker', position: 1, color: 'ColorBlue', point: [10, 20], icon: 'mil_warning', label: 'Danger', rotation: 45, scale: 1.5 })}>Edit existing marker</button></>,
  renderStylePreview: previewRenderer,
}))

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks() })

vi.mock('./collaboration', () => ({
  useCollaboration: (_mapID: string, initial: TacMap) => ({
    map: initial,
    connected: true,
    cursors: {},
    create: collaboration.create,
    update: collaboration.update,
    remove: collaboration.remove,
    cursor: vi.fn(),
  }),
}))

const user: User = { id: 'owner', username: 'owner', displayName: 'Owner', admin: false }
const map: TacMap = {
  id: 'map', name: 'Plan', world: 'altis', creatorId: user.id, version: 1, deleted: false, worldAvailable: false,
  layers: [
    { id: 'general', mapId: 'map', name: 'General', position: 0 },
    { id: 'intel', mapId: 'map', name: 'Intel', position: 1 },
  ],
}

it('selects the drawing layer directly from the layer list', () => {
  render(<Editor initial={map} user={user} onBack={vi.fn()} />)
  const general = screen.getByRole('radio', { name: 'General' })
  const intel = screen.getByRole('radio', { name: 'Intel' })
  const generalRow = general.closest('.layer-row')
  const intelRow = intel.closest('.layer-row')
  expect(general).toBeChecked()
  expect(generalRow).toHaveClass('visible', 'active')
  expect(intelRow).toHaveClass('visible')
  expect(intelRow).not.toHaveClass('active')
  fireEvent.click(intel)
  expect(intel).toBeChecked()
  expect(generalRow).toHaveClass('visible')
  expect(generalRow).not.toHaveClass('active')
  expect(intelRow).toHaveClass('visible', 'active')
  expect(screen.queryByRole('combobox', { name: 'Layer' })).not.toBeInTheDocument()
})

it('only offers separable detail controls for raster maps', () => {
  render(<Editor initial={{ ...map, worldAvailable: true }} user={user} world={{ name: 'lythium', size: 20480, styles: ['color-relief', 'topo'], format: 'raster', maxZoom: 7, hasMeta: false }} onBack={vi.fn()} />)
  const switcher = screen.getByLabelText('Map style: Topo')
  const image = switcher.querySelector('img')!
  expect(image).toHaveAttribute('src', '/api/worlds/lythium/previews/topo?v=0')
  fireEvent.error(image)
  expect(image).toHaveAttribute('src', '/api/worlds/lythium/assets/0/0/0.png')
  const details = switcher.closest('details')!
  fireEvent.mouseEnter(details)
  fireEvent.click(screen.getByRole('button', { name: 'Color Relief' }))
  expect(screen.getByLabelText('Map style: Color Relief')).toBeInTheDocument()
  expect(details).toHaveAttribute('open')
  fireEvent.mouseLeave(details)
  expect(details).not.toHaveAttribute('open')
  expect(screen.getByRole('checkbox', { name: 'terrain' })).toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: 'grid' })).toBeInTheDocument()
  expect(screen.queryByRole('checkbox', { name: 'roads' })).not.toBeInTheDocument()
})

it('shows progress while creating and saving missing vector previews', async () => {
  vi.spyOn(api, 'worldPreviewExists').mockResolvedValue(false)
  vi.spyOn(api, 'saveWorldPreview').mockResolvedValue()
  let finishFirst!: (preview: Blob) => void
  previewRenderer.mockReturnValueOnce(new Promise((resolve) => { finishFirst = resolve })).mockResolvedValue(new Blob(['png'], { type: 'image/png' }))
  const world: World = { name: 'dagger', size: 20480, styles: ['topo', 'topo-dark'], format: 'pmtiles', hasMeta: false }
  render(<Editor initial={{ ...map, worldAvailable: true }} user={user} world={world} onBack={vi.fn()} />)
  expect(await screen.findByRole('status')).toHaveTextContent('Creating map previews')
  await act(async () => finishFirst(new Blob(['png'], { type: 'image/png' })))
  await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
  expect(previewRenderer).toHaveBeenCalledTimes(2)
  expect(api.saveWorldPreview).toHaveBeenCalledTimes(2)
})

it('opens marker settings only after choosing a map position', () => {
  render(<Editor initial={{ ...map, worldAvailable: true }} user={user} world={{ name: 'altis', size: 100, styles: ['default'], format: 'pmtiles', hasMeta: false }} onBack={vi.fn()} />)
  expect(screen.getByText('Active tool: none')).toBeInTheDocument()
  const marker = screen.getByRole('button', { name: 'Marker' })
  fireEvent.click(marker)
  expect(screen.queryByRole('dialog', { name: 'Place marker' })).not.toBeInTheDocument()
  expect(screen.getByText('Active tool: marker')).toBeInTheDocument()
  expect(marker).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(screen.getByRole('button', { name: 'Click map for marker' }))
  expect(screen.getByRole('dialog', { name: 'Place marker' })).toBeInTheDocument()
  expect(screen.getByRole('group', { name: 'Shape' })).toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: 'Layer' })).toHaveValue('general')
  expect(screen.getByRole('group', { name: 'Color' })).toBeInTheDocument()
  expect(screen.getByRole('radio', { name: 'Black' })).toBeChecked()
  fireEvent.click(screen.getByRole('radio', { name: 'Red' }))
  expect(screen.queryByText('Preview')).not.toBeInTheDocument()
  expect(screen.getByRole('spinbutton', { name: 'Rotation' })).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Label' })).toBeInTheDocument()
  expect(screen.getByRole('spinbutton', { name: 'Scale' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Place marker' }))
  expect(collaboration.create).toHaveBeenCalledWith(expect.objectContaining({ kind: 'marker', point: [25, 35], color: 'ColorRed' }))
  expect(screen.getByText('Active tool: marker')).toBeInTheDocument()
  fireEvent.click(marker)
  expect(screen.getByText('Active tool: none')).toBeInTheDocument()
})

it('arms pointing from an explicit hand tool', () => {
  render(<Editor initial={{ ...map, worldAvailable: true }} user={user} world={{ name: 'altis', size: 100, styles: ['default'], format: 'pmtiles', hasMeta: false }} onBack={vi.fn()} />)
  const point = screen.getByRole('button', { name: 'Point' })
  fireEvent.click(point)
  expect(screen.getByText('Active tool: pointer')).toBeInTheDocument()
  expect(point).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByText(/hold mouse to share/i)).toBeInTheDocument()
  fireEvent.click(point)
  expect(screen.getByText('Active tool: none')).toBeInTheDocument()
})

it('offers distance and radius measurement tools', () => {
  render(<Editor initial={{ ...map, worldAvailable: true }} user={user} world={{ name: 'altis', size: 100, styles: ['default'], format: 'pmtiles', hasMeta: false }} onBack={vi.fn()} />)
  const distance = screen.getByRole('button', { name: 'Distance' })
  const radius = screen.getByRole('button', { name: 'Radius' })
  fireEvent.click(distance)
  expect(screen.getByText('Active tool: measure')).toBeInTheDocument()
  fireEvent.click(radius)
  expect(screen.getByText('Active tool: radius')).toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: 'Color' })).toBeInTheDocument()
  fireEvent.click(radius)
  expect(screen.getByText('Active tool: none')).toBeInTheDocument()
  expect(screen.queryByRole('combobox', { name: 'Color' })).not.toBeInTheDocument()
})

it('arms marker rotation without opening marker settings', () => {
  render(<Editor initial={{ ...map, worldAvailable: true }} user={user} world={{ name: 'altis', size: 100, styles: ['default'], format: 'pmtiles', hasMeta: false }} onBack={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Rotate' }))
  expect(screen.getByText('Active tool: rotate')).toBeInTheDocument()
  expect(screen.getByText(/click a marker, then drag its circle/i)).toBeInTheDocument()
  expect(screen.queryByRole('dialog', { name: 'Edit marker' })).not.toBeInTheDocument()
})

it('selects tools by keyboard without hijacking text input', () => {
  render(<Editor initial={{ ...map, worldAvailable: true }} user={user} world={{ name: 'altis', size: 100, styles: ['default'], format: 'pmtiles', hasMeta: false }} onBack={vi.fn()} />)
  fireEvent.keyDown(window, { key: 'r' })
  expect(screen.getByText('Active tool: rotate')).toBeInTheDocument()
  fireEvent.keyDown(window, { key: 'p' })
  expect(screen.getByText('Active tool: pointer')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Notes' }))
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Note' }), { key: 'm' })
  expect(screen.getByText('Active tool: pointer')).toBeInTheDocument()
})

it('edits an existing marker from its populated dialog', () => {
  render(<Editor initial={{ ...map, worldAvailable: true }} user={user} world={{ name: 'altis', size: 100, styles: ['default'], format: 'pmtiles', hasMeta: false }} onBack={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Edit existing marker' }))
  expect(screen.getByRole('dialog', { name: 'Edit marker' })).toBeInTheDocument()
  expect(screen.getByRole('radio', { name: 'Warning' })).toBeChecked()
  expect(screen.getByRole('radio', { name: 'Blue' })).toBeChecked()
  expect(screen.getByRole('textbox', { name: 'Label' })).toHaveValue('Danger')
  expect(screen.getByRole('spinbutton', { name: 'Rotation' })).toHaveValue(45)
  expect(screen.getByRole('spinbutton', { name: 'Scale' })).toHaveValue(150)
  fireEvent.change(screen.getByRole('textbox', { name: 'Label' }), { target: { value: 'Safe' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(collaboration.update).toHaveBeenCalledWith(expect.objectContaining({ id: 'placed', label: 'Safe' }))
})

it('deletes an existing marker from its dialog', () => {
  render(<Editor initial={{ ...map, worldAvailable: true }} user={user} world={{ name: 'altis', size: 100, styles: ['default'], format: 'pmtiles', hasMeta: false }} onBack={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Edit existing marker' }))
  fireEvent.click(screen.getByRole('button', { name: 'Delete marker' }))
  expect(collaboration.remove).toHaveBeenCalledWith('placed')
  expect(screen.queryByRole('dialog', { name: 'Edit marker' })).not.toBeInTheDocument()
})

it('adds notes to the selected layer from the notes rail', () => {
  render(<Editor initial={{ ...map, worldAvailable: true }} user={user} world={{ name: 'altis', size: 100, styles: ['default'], format: 'pmtiles', hasMeta: false }} onBack={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Notes' }))
  expect(screen.queryByRole('combobox', { name: 'Note layer' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('radio', { name: 'Intel' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: 'Hold the northern approach' } })
  fireEvent.click(screen.getByRole('button', { name: 'Add note' }))
  expect(collaboration.create).toHaveBeenCalledWith(expect.objectContaining({ kind: 'note', layerId: 'intel', text: 'Hold the northern approach' }))
})

it('moves an existing note to another layer', () => {
  const withNote: TacMap = { ...map, worldAvailable: true, layers: [{ ...map.layers[0], annotations: [{ id: 'note', mapId: 'map', layerId: 'general', kind: 'note', position: 0, color: 'ColorYellow', text: 'Move me' }] }, map.layers[1]] }
  render(<Editor initial={withNote} user={user} world={{ name: 'altis', size: 100, styles: ['default'], format: 'pmtiles', hasMeta: false }} onBack={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Notes' }))
  fireEvent.change(screen.getByRole('combobox', { name: 'Layer for Move me' }), { target: { value: 'intel' } })
  expect(collaboration.update).toHaveBeenCalledWith(expect.objectContaining({ id: 'note', layerId: 'intel' }))
})

it('hides notes with their layer', () => {
  const withNote: TacMap = { ...map, worldAvailable: true, layers: [{ ...map.layers[0], annotations: [{ id: 'note', mapId: 'map', layerId: 'general', kind: 'note', position: 0, color: 'ColorYellow', text: 'Hidden with layer' }] }, map.layers[1]] }
  render(<Editor initial={withNote} user={user} world={{ name: 'altis', size: 100, styles: ['default'], format: 'pmtiles', hasMeta: false }} onBack={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Notes' }))
  expect(screen.getByText('Hidden with layer')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Draw' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Hide General' }))
  fireEvent.click(screen.getByRole('button', { name: 'Notes' }))
  expect(screen.queryByText('Hidden with layer')).not.toBeInTheDocument()
})

it('opens draw first and toggles one left sidebar panel at a time', () => {
  render(<Editor initial={map} user={user} onBack={vi.fn()} />)
  const draw = screen.getByRole('button', { name: 'Draw' })
  const notes = screen.getByRole('button', { name: 'Notes' })
  expect(draw).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('complementary', { name: 'Drawing controls' })).toBeInTheDocument()
  expect(screen.queryByRole('complementary', { name: 'Map notes' })).not.toBeInTheDocument()
  fireEvent.click(notes)
  expect(draw).toHaveAttribute('aria-pressed', 'false')
  expect(notes).toHaveAttribute('aria-pressed', 'true')
  expect(screen.queryByRole('complementary', { name: 'Drawing controls' })).not.toBeInTheDocument()
  expect(screen.getByRole('complementary', { name: 'Map notes' })).toBeInTheDocument()
  fireEvent.click(notes)
  expect(notes).toHaveAttribute('aria-pressed', 'false')
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
})

it('moves map management into settings and reserves history for admins', () => {
  render(<Editor initial={map} user={user} onBack={vi.fn()} />)
  expect(screen.queryByRole('button', { name: 'History' })).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Revision history' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Rename map' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
  expect(screen.getByRole('complementary', { name: 'Map settings' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Rename map' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Trash map' })).toBeInTheDocument()
})

it('shows the latest history first to admins', async () => {
  vi.spyOn(api, 'revisions').mockResolvedValue([
    { id: 1, mapId: 'map', version: 1, actor: user, kind: 'map.create', createdAt: 1 },
    { id: 2, mapId: 'map', version: 2, actor: user, kind: 'map.rename', createdAt: 2 },
    { id: 3, mapId: 'map', version: 3, actor: user, kind: 'annotation.create', createdAt: 3, data: { annotation: { id: 'note', mapId: 'map', layerId: 'general', kind: 'note', position: 0, color: 'ColorYellow', text: 'Hold the bridge' } } },
  ])
  render(<Editor initial={map} user={{ ...user, id: 'admin', admin: true }} onBack={vi.fn()} />)
  const history = screen.getByRole('button', { name: 'History' })
  expect(history).toHaveAttribute('aria-controls', 'history-panel')
  expect(screen.queryByRole('heading', { name: 'Revision history' })).not.toBeInTheDocument()
  fireEvent.click(history)
  expect(history).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('complementary', { name: 'Revision history' })).toBeInTheDocument()
  expect(api.revisions).toHaveBeenCalledWith('map')
  expect((await screen.findAllByText(/^v[1-3]$/)).map(({ textContent }) => textContent)).toEqual(['v3', 'v2', 'v1'])
  expect(screen.getByText('Current')).toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: 'Restore this version' })).toHaveLength(2)
  expect(screen.getByText('Note added')).toBeInTheDocument()
  expect(screen.getByText('Hold the bridge')).toBeInTheDocument()
})

it('restores the state before a deleted annotation', async () => {
  const deleted: Revision = { id: 3, mapId: 'map', version: 3, actor: user, kind: 'annotation.delete', createdAt: 3, data: { annotation: { id: 'note', mapId: 'map', layerId: 'general', kind: 'note', position: 0, color: 'ColorYellow', text: 'Bring me back' } } }
  const revisions = vi.spyOn(api, 'revisions').mockResolvedValueOnce([deleted]).mockResolvedValueOnce([deleted, { id: 4, mapId: 'map', version: 4, actor: user, kind: 'history.restore', createdAt: 4, data: { snapshot: { ...map, version: 2 } } }])
  vi.spyOn(api, 'restore').mockResolvedValue(map)
  render(<Editor initial={map} user={{ ...user, id: 'admin', admin: true }} onBack={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'History' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Undo deletion' }))
  expect(api.restore).toHaveBeenCalledWith('map', 2)
  await waitFor(() => expect(revisions).toHaveBeenCalledTimes(2))
  expect(await screen.findByText('Revision restored')).toBeInTheDocument()
  expect(screen.getByText('Current')).toBeInTheDocument()
  expect(screen.getByText('Undone')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Undo deletion' })).not.toBeInTheDocument()
})
