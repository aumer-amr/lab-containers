import { expect, it, vi } from 'vitest'

it('loads Leaflet plugins after publishing the Leaflet global', async () => {
  await expect(import('./MapCanvas')).resolves.toHaveProperty('MapCanvas')
})

it('rewrites OCAP map paths to authenticated world assets', async () => {
  const { styleAssetURL } = await import('./MapCanvas')
  expect(styleAssetURL('pmtiles://images/maps/blood_optre/tiles/features.pmtiles', 'blood_optre', 'http://localhost:8080')).toBe('pmtiles://http://localhost:8080/api/worlds/blood_optre/assets/tiles/features.pmtiles')
})

it('maps GDAL raster styles and Arma coordinates to their tile pyramid', async () => {
  const { projectPoint, rasterCRS, rasterTileURL, unprojectPoint } = await import('./MapCanvas')
  const world = { format: 'raster' as const }
  expect(rasterTileURL('lythium', 'topo-relief')).toBe('/api/worlds/lythium/assets/topoRelief/{z}/{x}/{y}.png')
  expect(rasterTileURL('lythium', 'topo')).toBe('/api/worlds/lythium/assets/{z}/{x}/{y}.png')
  expect(projectPoint(world, [1200, 3400])).toEqual([3400, 1200])
  expect(unprojectPoint(world, [3400, 1200])).toEqual([1200, 3400])
  expect(rasterCRS(20480).latLngToPoint({ lat: 0, lng: 0 } as never, 0)).toMatchObject({ x: 0, y: 20480 })
  expect(rasterCRS(20480).latLngToPoint({ lat: 20480, lng: 20480 } as never, 0)).toMatchObject({ x: 20480, y: 0 })
})

it('keeps every terrain style on the page background color', async () => {
  const { normalizeStyleBackground } = await import('./MapCanvas')
  const style = { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#ffffff' } }] }
  const paint = normalizeStyleBackground(style as never).layers[0].paint as Record<string, unknown>
  expect(paint['background-color']).toBe('#232325')
})

it('renders the real PlanOps marker artwork instead of its identifier', async () => {
  const { markerHTML } = await import('./MapCanvas')
  const html = markerHTML({ icon: 'mil_warning', color: 'ColorRed', label: 'Danger', rotation: 45, scale: 1.5 })
  expect(html).toContain('/markers/colorred/mil_warning.png')
  expect(html).not.toContain('https://')
  expect(html).toContain('<span style="color:#ef4444">Danger</span>')
  expect(html).not.toContain('>mil_warning<')
})

it('renders pink lines as pink instead of the fallback orange', async () => {
  const { cssColor } = await import('./MapCanvas')
  expect(cssColor('ColorPink')).toBe('#ec4899')
})

it('moves one persistent remote pointer instead of recreating it', async () => {
  const { syncRemoteCursors } = await import('./MapCanvas')
  const marker = { setLatLng: vi.fn(), remove: vi.fn() }
  const create = vi.fn(() => marker)
  const markers = new Map()
  const user = { id: 'owner', username: 'owner', displayName: 'Owner', admin: false }
  syncRemoteCursors(markers, { owner: { user, point: [1, 2] as [number, number] } }, create)
  syncRemoteCursors(markers, { owner: { user, point: [3, 4] as [number, number] } }, create)
  expect(create).toHaveBeenCalledOnce()
  expect(marker.setLatLng).toHaveBeenCalledOnce()
  syncRemoteCursors(markers, {}, create)
  expect(marker.remove).toHaveBeenCalledOnce()
})

it('renders a named yellow-dot pointer', async () => {
  const { remoteCursorHTML } = await import('./MapCanvas')
  expect(remoteCursorHTML('2LT <Evers>')).toBe('<i class="pointer-dot"></i><span>2LT &lt;Evers&gt;</span>')
})

it('uses Delete for map selections without hijacking form fields', async () => {
  const { isDeleteShortcut } = await import('./MapCanvas')
  expect(isDeleteShortcut({ key: 'Delete', target: document.body })).toBe(true)
  expect(isDeleteShortcut({ key: 'Backspace', target: document.body })).toBe(false)
  expect(isDeleteShortcut({ key: 'Delete', target: document.createElement('input') })).toBe(false)
})

it('uses readable tactical grid intervals and coordinate labels', async () => {
  const { coordinateGridInterval, coordinateGridLabel } = await import('./MapCanvas')
  expect(coordinateGridInterval(.5)).toBe(50)
  expect(coordinateGridInterval(5)).toBe(500)
  expect(coordinateGridLabel(1500, 500)).toBe('015')
  expect(coordinateGridLabel(10000, 2000)).toBe('10')
})

it('calculates distance, radius labels, and compass mils from Arma coordinates', async () => {
  const { measurementHTML, milHeading, pointDistance } = await import('./MapCanvas')
  expect(pointDistance([0, 0], [300, 400])).toBe(500)
  expect(milHeading([0, 0], [0, 100])).toBe(0)
  expect(milHeading([0, 0], [100, 0])).toBe(1600)
  expect(measurementHTML('radius', [[0, 0], [300, 400]])).toBe('Radius 500 m')
})

it('maps terrain detail controls to the actual OCAP style layers', async () => {
  const { applyCategories } = await import('./MapCanvas')
  const layers = [
    { id: 'contours50-label', type: 'symbol', 'source-layer': 'contours50' },
    { id: 'road-outline', type: 'line', 'source-layer': 'road' },
    { id: 'house-extrusion', type: 'fill-extrusion', 'source-layer': 'house' },
    { id: 'forest', type: 'fill', 'source-layer': 'forest' },
    { id: 'tree', type: 'circle', 'source-layer': 'tree' },
  ]
  const setLayoutProperty = vi.fn()
  const map = { isStyleLoaded: () => true, getStyle: () => ({ layers }), setLayoutProperty }
  applyCategories(map as never, { terrain: true, roads: false, buildings: false, vegetation: false, labels: false })
  expect(setLayoutProperty.mock.calls).toEqual([
    ['contours50-label', 'visibility', 'none'],
    ['road-outline', 'visibility', 'none'],
    ['house-extrusion', 'visibility', 'none'],
    ['forest', 'visibility', 'none'],
    ['tree', 'visibility', 'none'],
  ])
})
