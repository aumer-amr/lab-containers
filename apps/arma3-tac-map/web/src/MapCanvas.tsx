import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css'
import 'leaflet/dist/leaflet.css'
import 'maplibre-gl/dist/maplibre-gl.css'
import L from 'leaflet'
import maplibregl, { type LayerSpecification, type Map as MapLibreMap, type StyleSpecification } from 'maplibre-gl'
import { Protocol } from 'pmtiles'
import { useEffect, useRef, useState } from 'react'
import { leafletPluginsReady } from './leafletPlugins'
import { markerImageURL } from './markers'
import { toArma, toLeaflet } from './state'
import type { RemoteCursor } from './state'
import type { Annotation, Point, World } from './types'

const protocol = new Protocol()
const mapVoidColor = '#232325'
maplibregl.addProtocol('pmtiles', protocol.tile)

type MapLibreLayer = L.Layer & { getMaplibreMap(): MapLibreMap }
type LeafletWithMapLibre = typeof L & { maplibreGL(options: { style: StyleSpecification }): MapLibreLayer }
type EditableLayer = L.Layer & { pm?: { enable(): void } }
type SelectedLine = { id: string; layer: L.Polyline; normalWeight: number; related?: L.Path }
type RemoteCursorMarker = { setLatLng(point: L.LatLngExpression): unknown; remove(): unknown }

type Props = {
  world: World
  style: string
  categories: Record<string, boolean>
  annotations: Annotation[]
  cursors: Record<string, RemoteCursor>
  editing: boolean
  activeTool: 'pointer' | 'marker' | 'rotate' | 'polyline' | 'freehand' | 'measure' | 'radius' | null
  layerID: string
  color: string
  icon: string
  label: string
  rotation: number
  scale: number
  onCreate(annotation: Omit<Annotation, 'id' | 'mapId'>): void
  onUpdate(annotation: Annotation): void
  onDelete(id: string): void
  onPlaceMarker(point: Point): void
  onEditMarker(annotation: Annotation): void
  onCursor(point: Point | null): void
}

async function loadStyle(world: string, style: string): Promise<StyleSpecification> {
  const prefix = `/api/worlds/${encodeURIComponent(world)}/assets/`
  const response = await fetch(`${prefix}styles/${encodeURIComponent(style)}.json`)
  if (!response.ok) throw new Error('Terrain style unavailable')
  const value = await response.json() as Record<string, unknown>
  const rewrite = (item: unknown): unknown => {
    if (typeof item === 'string') {
      return styleResourceURL(item, world)
    }
    if (Array.isArray(item)) return item.map(rewrite)
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, rewrite(child)]))
    return item
  }
  return normalizeStyleBackground(rewrite(value) as StyleSpecification)
}

export function normalizeStyleBackground(style: StyleSpecification) {
  for (const layer of style.layers ?? []) {
    if (layer.type === 'background') layer.paint = { ...layer.paint, 'background-color': mapVoidColor }
  }
  return style
}

export async function renderStylePreview(world: World, styleName: string) {
  if (world.format !== 'pmtiles') throw new Error('Only vector styles require rendered previews')
  const container = document.createElement('div')
  container.className = 'style-renderer'
  document.body.append(container)
  let map: MapLibreMap | undefined
  try {
    map = new maplibregl.Map({
      container,
      style: await loadStyle(world.name, styleName),
      interactive: false,
      attributionControl: false,
      canvasContextAttributes: { preserveDrawingBuffer: true },
    })
    const [south, west] = toLeaflet([0, 0])
    const [north, east] = toLeaflet([world.size, world.size])
    map.fitBounds([[west, south], [east, north]], { padding: 10, animate: false })
    await waitForPreview(map)
    const blob = await new Promise<Blob | null>((resolve) => map!.getCanvas().toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('Preview rendering failed')
    return blob
  } finally {
    map?.remove()
    container.remove()
  }
}

export function waitForPreview(map: Pick<MapLibreMap, 'once'>, deadline = 20_000) {
  return new Promise<void>((resolve) => {
    const timeout = window.setTimeout(resolve, deadline)
    map.once('idle', () => { clearTimeout(timeout); resolve() })
  })
}

export function styleAssetURL(value: string, world: string, origin = location.origin): string {
  const prefix = `/api/worlds/${encodeURIComponent(world)}/assets/`
  const worldPrefix = `images/maps/${world}/`
  let asset = value.slice('pmtiles://'.length).replace(/^\.\//, '')
  if (asset.startsWith(worldPrefix)) asset = asset.slice(worldPrefix.length)
  return `pmtiles://${origin}${prefix}${asset}`
}

export function styleResourceURL(value: string, world: string, origin = location.origin) {
  if (value.startsWith('pmtiles://')) return styleAssetURL(value, world, origin)
  for (const kind of ['fonts', 'sprites']) {
    const prefix = `images/maps/${kind}/`
    if (value.startsWith(prefix)) return `${origin}/api/assets/${kind}/${value.slice(prefix.length)}`
    if (value.startsWith(`${kind}/`)) return `${origin}/api/assets/${value}`
  }
  return value
}

export function rasterTileURL(world: string, style: string) {
  const directory = ({ 'color-relief': 'colorRelief/', 'topo-dark': 'topoDark/', 'topo-relief': 'topoRelief/' } as Record<string, string>)[style] ?? ''
  return `/api/worlds/${encodeURIComponent(world)}/assets/${directory}{z}/{x}/{y}.png`
}

export function projectPoint(world: Pick<World, 'format'>, point: Point): [number, number] {
  return world.format === 'raster' ? [point[1], point[0]] : toLeaflet(point)
}

export function unprojectPoint(world: Pick<World, 'format'>, point: [number, number]): Point {
  return world.format === 'raster' ? [point[1], point[0]] : toArma(point)
}

export function rasterCRS(worldSize: number): L.CRS {
  return L.extend({}, L.CRS.Simple, { transformation: new L.Transformation(1, 0, -1, worldSize) }) as L.CRS
}

export function observeMapResize(element: Element, map: Pick<L.Map, 'invalidateSize'>) {
  const observer = new ResizeObserver(() => map.invalidateSize({ pan: false }))
  observer.observe(element)
  return () => observer.disconnect()
}

export function MapCanvas(props: Props) {
  const [pluginsReady, setPluginsReady] = useState(false)
  const [rotatingMarkerID, setRotatingMarkerID] = useState<string | null>(null)
  const element = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const vectorTerrainRef = useRef<MapLibreLayer | null>(null)
  const rasterTerrainRef = useRef<L.TileLayer | null>(null)
  const annotationGroup = useRef<L.LayerGroup | null>(null)
  const cursorGroup = useRef<L.LayerGroup | null>(null)
  const cursorMarkers = useRef(new Map<string, L.Marker>())
  const selectedLine = useRef<SelectedLine | null>(null)
  const current = useRef(props)
  current.current = props

  useEffect(() => {
    let active = true
    void leafletPluginsReady.then(() => { if (active) setPluginsReady(true) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!element.current || !pluginsReady) return
    const raster = props.world.format === 'raster'
    const map = L.map(element.current, { crs: raster ? rasterCRS(props.world.size) : L.CRS.EPSG3857, minZoom: raster ? -(props.world.maxZoom ?? 0) : 1, maxZoom: raster ? 2 : 22, zoomControl: true, doubleClickZoom: false })
    map.fitBounds([projectPoint(props.world, [0, 0]), projectPoint(props.world, [props.world.size, props.world.size])])
    const stopObserving = observeMapResize(element.current, map)
    annotationGroup.current = L.layerGroup().addTo(map)
    cursorGroup.current = L.layerGroup().addTo(map)
    mapRef.current = map
    return () => { stopObserving(); map.remove(); mapRef.current = null; cursorMarkers.current.clear() }
  }, [pluginsReady, props.world.format, props.world.maxZoom, props.world.name, props.world.size])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !pluginsReady) return
    vectorTerrainRef.current?.remove()
    rasterTerrainRef.current?.remove()
    vectorTerrainRef.current = null
    rasterTerrainRef.current = null
    if (props.world.format === 'raster') {
      const maxZoom = props.world.maxZoom ?? 0
      rasterTerrainRef.current = L.tileLayer(rasterTileURL(props.world.name, props.style), {
        bounds: [[0, 0], [props.world.size, props.world.size]],
        minZoom: -maxZoom,
        maxZoom: 2,
        minNativeZoom: -maxZoom,
        maxNativeZoom: 0,
        zoomOffset: maxZoom,
        noWrap: true,
      }).setOpacity(props.categories.terrain ? 1 : 0).addTo(map)
      return () => { rasterTerrainRef.current?.remove(); rasterTerrainRef.current = null }
    }
    let cancelled = false
    loadStyle(props.world.name, props.style).then((style) => {
      if (cancelled) return
      vectorTerrainRef.current = (L as LeafletWithMapLibre).maplibreGL({ style }).addTo(map) as MapLibreLayer
      vectorTerrainRef.current.getMaplibreMap().once('load', () => applyCategories(vectorTerrainRef.current?.getMaplibreMap(), current.current.categories))
    }).catch(() => undefined)
    return () => { cancelled = true; vectorTerrainRef.current?.remove(); vectorTerrainRef.current = null }
  }, [pluginsReady, props.style, props.world.format, props.world.maxZoom, props.world.name, props.world.size])

  useEffect(() => {
    rasterTerrainRef.current?.setOpacity(props.categories.terrain ? 1 : 0)
    applyCategories(vectorTerrainRef.current?.getMaplibreMap(), props.categories)
  }, [props.categories])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !pluginsReady || !props.categories.grid) return
    if (!map.getPane('gridPane')) {
      const pane = map.createPane('gridPane')
      pane.style.zIndex = '350'
      pane.style.pointerEvents = 'none'
    }
    const grid = L.layerGroup().addTo(map)
    const update = () => drawCoordinateGrid(map, grid, props.world)
    update()
    map.on('moveend zoomend resize', update)
    return () => { map.off('moveend zoomend resize', update); grid.remove() }
  }, [pluginsReady, props.categories.grid, props.world])

  useEffect(() => {
    const removeSelected = (event: KeyboardEvent) => {
      if (!current.current.editing || !selectedLine.current || !isDeleteShortcut(event)) return
      event.preventDefault()
      const id = selectedLine.current.id
      selectedLine.current = null
      current.current.onDelete(id)
    }
    window.addEventListener('keydown', removeSelected)
    return () => window.removeEventListener('keydown', removeSelected)
  }, [])

  useEffect(() => {
    const group = annotationGroup.current
    const map = mapRef.current
    if (!group || !map) return
    group.clearLayers()
    let stopRotating = () => {}
    let selectedFound = false
    for (const annotation of props.annotations) {
      if (annotation.kind === 'note') continue
      let layer: L.Layer
      let related: L.Path | undefined
      if (annotation.kind === 'marker' && annotation.point) {
        const selected = props.activeTool === 'rotate' && rotatingMarkerID === annotation.id
        layer = L.marker(projectPoint(props.world, annotation.point), { icon: L.divIcon({ className: `mil-marker${selected ? ' rotation-selected' : ''}`, iconSize: selected ? [56, 56] : [32, 32], iconAnchor: selected ? [28, 28] : [16, 16], html: markerHTML(annotation, selected) }) })
      } else {
        const selected = props.editing && selectedLine.current?.id === annotation.id
        const points = annotation.points ?? []
        const measurement = annotation.kind === 'measure' || annotation.kind === 'radius'
        const normalWeight = measurement ? 2 : 4
        const line = L.polyline(points.map((point) => projectPoint(props.world, point)), { color: cssColor(annotation.color), weight: selected ? 7 : normalWeight, dashArray: measurement ? '6 6' : undefined })
        if (annotation.kind === 'radius' && points.length === 2) related = L.circle(projectPoint(props.world, points[0]), { radius: pointDistance(points[0], points[1]), color: cssColor(annotation.color), weight: selected ? 7 : 2, dashArray: '6 6', fill: false }).addTo(group)
        if (measurement && points.length === 2) line.bindTooltip(measurementHTML(annotation.kind as 'measure' | 'radius', points as [Point, Point]), { className: 'measurement-tooltip', direction: 'center', permanent: true })
        layer = line
        if (selected) { selectedFound = true; selectedLine.current = { id: annotation.id, layer: line, normalWeight, related } }
      }
      if (annotation.kind === 'marker') {
        layer.on('click', () => {
          if (!current.current.editing) return
          if (current.current.activeTool === 'rotate') setRotatingMarkerID(annotation.id)
          else current.current.onEditMarker(annotation)
        })
        layer.on('mousedown', (event: L.LeafletMouseEvent) => {
          if (!current.current.editing || current.current.activeTool !== 'rotate' || rotatingMarkerID !== annotation.id || event.originalEvent.button !== 0 || !(layer instanceof L.Marker)) return
          L.DomEvent.stopPropagation(event.originalEvent)
          let changed = false
          let rotation = annotation.rotation ?? 0
          const origin = map.latLngToContainerPoint(layer.getLatLng())
          const rotate = (moveEvent: L.LeafletMouseEvent) => {
            const target = map.latLngToContainerPoint(moveEvent.latlng)
            if (target.equals(origin)) return
            changed = true
            rotation = markerRotation(origin, target)
            const image = layer.getElement()?.querySelector('img')
            if (image) image.style.transform = `rotate(${rotation}deg) scale(${annotation.scale ?? 1})`
            const control = layer.getElement()?.querySelector<HTMLElement>('.rotation-control')
            if (control) control.style.transform = `rotate(${rotation}deg)`
          }
          const finish = () => {
            map.off('mousemove', rotate).off('mouseup mouseout', finish)
            map.dragging.enable()
            layer.getElement()?.classList.remove('rotation-dragging')
            stopRotating = () => {}
            if (changed) current.current.onUpdate({ ...annotation, rotation })
          }
          stopRotating()
          stopRotating = () => { map.off('mousemove', rotate).off('mouseup mouseout', finish); map.dragging.enable(); layer.getElement()?.classList.remove('rotation-dragging') }
          map.dragging.disable()
          layer.getElement()?.classList.add('rotation-dragging')
          map.on('mousemove', rotate).on('mouseup mouseout', finish)
        })
      } else {
        const select = () => {
          if (!current.current.editing || !(layer instanceof L.Polyline)) return
          selectedLine.current?.layer.setStyle({ weight: selectedLine.current.normalWeight })
          selectedLine.current?.related?.setStyle({ weight: 2 })
          selectedLine.current = { id: annotation.id, layer, normalWeight: annotation.kind === 'measure' || annotation.kind === 'radius' ? 2 : 4, related }
          layer.setStyle({ weight: 7 })
          related?.setStyle({ weight: 7 })
          const editable = layer as EditableLayer
          editable.pm?.enable()
        }
        layer.on('click', select)
        related?.on('click', select)
      }
      layer.on('pm:edit', () => {
        if (layer instanceof L.Marker) current.current.onUpdate({ ...annotation, point: unprojectPoint(props.world, [layer.getLatLng().lat, layer.getLatLng().lng]) })
        if (layer instanceof L.Polyline) {
          const points = (layer.getLatLngs() as L.LatLng[]).map(({ lat, lng }) => unprojectPoint(props.world, [lat, lng]))
          current.current.onUpdate({ ...annotation, points: annotation.kind === 'measure' || annotation.kind === 'radius' ? [points[0], points.at(-1)!] : points })
        }
      })
      group.addLayer(layer)
    }
    if (!selectedFound) selectedLine.current = null
    return () => stopRotating()
  }, [props.activeTool, props.annotations, props.editing, props.world, rotatingMarkerID])

  useEffect(() => {
    const group = cursorGroup.current
    if (!group) return
    syncRemoteCursors(cursorMarkers.current, props.cursors, ({ user, point }) => L.marker(projectPoint(props.world, point), { interactive: false, icon: L.divIcon({ className: 'remote-cursor', iconSize: [12, 12], iconAnchor: [6, 6], html: remoteCursorHTML(user.displayName) }) }).addTo(group), (point) => projectPoint(props.world, point))
  }, [props.cursors, props.world])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !props.editing || !props.activeTool) return

    if (props.activeTool === 'pointer') {
      let pointing = false
      const send = (event: L.LeafletMouseEvent) => current.current.onCursor(unprojectPoint(current.current.world, [event.latlng.lat, event.latlng.lng]))
      const start = (event: L.LeafletMouseEvent) => {
        if ((event.originalEvent as MouseEvent).button !== 0 || targetsAnnotation(event)) return
        pointing = true
        map.dragging.disable()
        send(event)
      }
      const move = (event: L.LeafletMouseEvent) => { if (pointing) send(event) }
      const finish = () => {
        if (!pointing) return
        pointing = false
        map.dragging.enable()
        current.current.onCursor(null)
      }
      map.getContainer().classList.add('pointing-armed')
      map.on('mousedown', start).on('mousemove', move).on('mouseup mouseout', finish)
      return () => { map.off('mousedown', start).off('mousemove', move).off('mouseup mouseout', finish); finish(); map.getContainer().classList.remove('pointing-armed') }
    }

    map.getContainer().classList.add('drawing-armed')

    if (props.activeTool === 'rotate') {
      const clearSelection = (event: L.LeafletMouseEvent) => { if (!targetsAnnotation(event)) setRotatingMarkerID(null) }
      map.getContainer().classList.add('rotate-armed')
      map.getContainer().classList.remove('drawing-armed')
      map.on('click', clearSelection)
      return () => { map.off('click', clearSelection); map.getContainer().classList.remove('rotate-armed') }
    }

    if (props.activeTool === 'marker') {
      const place = (event: L.LeafletMouseEvent) => {
        if (targetsAnnotation(event)) return
        current.current.onPlaceMarker(unprojectPoint(current.current.world, [event.latlng.lat, event.latlng.lng]))
      }
      map.on('click', place)
      return () => { map.off('click', place); map.getContainer().classList.remove('drawing-armed') }
    }

    if (props.activeTool === 'polyline') {
      let points: L.LatLng[] = []
      let preview: L.Polyline | null = null
      const move = (event: L.LeafletMouseEvent) => preview?.setLatLngs([...points, event.latlng])
      const click = (event: L.LeafletMouseEvent) => {
        if (targetsAnnotation(event)) return
        if (!preview) {
          points = [event.latlng]
          preview = L.polyline([event.latlng, event.latlng], { color: cssColor(current.current.color), weight: 4, dashArray: '7 7', interactive: false }).addTo(map)
          return
        }
        if (event.originalEvent.ctrlKey || event.originalEvent.shiftKey) {
          points.push(event.latlng)
          preview.setLatLngs([...points, event.latlng])
          return
        }
        const finished = [...points, event.latlng]
        preview.remove()
        preview = null
        points = []
        const value = current.current
        value.onCreate({ layerId: value.layerID, kind: 'polyline', position: Date.now(), color: value.color, points: finished.map(({ lat, lng }) => unprojectPoint(value.world, [lat, lng])) })
      }
      const undo = () => {
        if (!preview) return
        if (points.length > 1) { points.pop(); preview.setLatLngs(points) }
        else { preview.remove(); preview = null; points = [] }
      }
      map.on('mousemove', move).on('click', click).on('contextmenu', undo)
      return () => { map.off('mousemove', move).off('click', click).off('contextmenu', undo); preview?.remove(); map.getContainer().classList.remove('drawing-armed') }
    }

    if (props.activeTool === 'measure' || props.activeTool === 'radius') {
      let start: L.LatLng | null = null
      let guide: L.Polyline | null = null
      let circle: L.Circle | null = null
      const clear = () => { guide?.remove(); circle?.remove(); start = null; guide = null; circle = null }
      const update = (end: L.LatLng) => {
        if (!start || !guide) return
        guide.setLatLngs([start, end])
        const value = current.current
        guide.setStyle({ color: cssColor(value.color) })
        circle?.setStyle({ color: cssColor(value.color) })
        const points: [Point, Point] = [unprojectPoint(value.world, [start.lat, start.lng]), unprojectPoint(value.world, [end.lat, end.lng])]
        guide.setTooltipContent(measurementHTML(value.activeTool as 'measure' | 'radius', points))
        circle?.setRadius(pointDistance(points[0], points[1]))
      }
      const click = (event: L.LeafletMouseEvent) => {
        if (targetsAnnotation(event)) return
        if (!start) {
          start = event.latlng
          guide = L.polyline([start, start], { color: cssColor(current.current.color), weight: 2, dashArray: '6 6', interactive: false }).bindTooltip('', { className: 'measurement-tooltip', direction: 'center', permanent: true }).addTo(map)
          if (current.current.activeTool === 'radius') circle = L.circle(start, { radius: 0, color: cssColor(current.current.color), weight: 2, dashArray: '6 6', fill: false, interactive: false }).addTo(map)
          return
        }
        update(event.latlng)
        const value = current.current
        const points: [Point, Point] = [unprojectPoint(value.world, [start.lat, start.lng]), unprojectPoint(value.world, [event.latlng.lat, event.latlng.lng])]
        value.onCreate({ layerId: value.layerID, kind: value.activeTool as 'measure' | 'radius', position: Date.now(), color: value.color, points })
        clear()
      }
      const move = (event: L.LeafletMouseEvent) => update(event.latlng)
      map.on('mousemove', move).on('click', click).on('contextmenu', clear)
      return () => { map.off('mousemove', move).off('click', click).off('contextmenu', clear); clear(); map.getContainer().classList.remove('drawing-armed') }
    }

    let drawing = false
    let points: Point[] = []
    const move = (event: L.LeafletMouseEvent) => { if (drawing) points.push(unprojectPoint(current.current.world, [event.latlng.lat, event.latlng.lng])) }
    const finish = () => {
      if (!drawing) return
      drawing = false
      map.dragging.enable()
      if (points.length >= 2) {
        const value = current.current
        value.onCreate({ layerId: value.layerID, kind: 'freehand', position: Date.now(), color: value.color, points })
      }
      points = []
    }
    const start = (event: L.LeafletMouseEvent) => {
      if ((event.originalEvent as MouseEvent).button !== 0 || targetsAnnotation(event)) return
      drawing = true
      points = [unprojectPoint(current.current.world, [event.latlng.lat, event.latlng.lng])]
      map.dragging.disable()
    }
    map.on('mousedown', start).on('mousemove', move).on('mouseup mouseout', finish)
    return () => { map.off('mousedown', start).off('mousemove', move).off('mouseup mouseout', finish); if (drawing) map.dragging.enable(); map.getContainer().classList.remove('drawing-armed') }
  }, [props.activeTool, props.editing])

  return <section className="map-panel" aria-label="Tactical map editor"><div className="map" ref={element} /></section>
}

function targetsAnnotation(event: L.LeafletMouseEvent) { return Boolean((event.originalEvent.target as Element | null)?.closest('.leaflet-marker-icon, .leaflet-interactive')) }

const gridIntervals = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]

export function coordinateGridInterval(metersPerPixel: number) {
  return gridIntervals.find((interval) => interval >= metersPerPixel * 96) ?? gridIntervals.at(-1)!
}

export function coordinateGridLabel(value: number, interval: number) {
  const unit = interval >= 1000 ? 1000 : interval >= 100 ? 100 : 10
  const digits = unit === 1000 ? 2 : unit === 100 ? 3 : 4
  return Math.round(value / unit).toString().padStart(digits, '0')
}

function drawCoordinateGrid(map: L.Map, group: L.LayerGroup, world: World) {
  group.clearLayers()
  const bounds = map.getBounds()
  const [west, south] = unprojectPoint(world, [bounds.getSouth(), bounds.getWest()])
  const [east, north] = unprojectPoint(world, [bounds.getNorth(), bounds.getEast()])
  const worldSize = world.size
  const visibleWest = Math.max(0, west)
  const visibleSouth = Math.max(0, south)
  const visibleEast = Math.min(worldSize, east)
  const visibleNorth = Math.min(worldSize, north)
  if (visibleWest >= visibleEast || visibleSouth >= visibleNorth) return
  const interval = coordinateGridInterval((visibleEast - visibleWest) / Math.max(1, map.getSize().x))
  const line = (value: number): L.PolylineOptions => ({ pane: 'gridPane', interactive: false, color: '#000000', opacity: value % (interval * 5) === 0 ? .75 : .5, weight: value % (interval * 5) === 0 ? 1.4 : .8 })
  const label = (value: number, axis: 'easting' | 'northing') => L.divIcon({ className: `grid-coordinate grid-${axis}`, iconSize: [42, 16], iconAnchor: axis === 'easting' ? [21, 16] : [42, 8], html: coordinateGridLabel(value, interval) })

  for (let easting = Math.ceil(visibleWest / interval) * interval; easting <= visibleEast; easting += interval) {
    L.polyline([projectPoint(world, [easting, visibleSouth]), projectPoint(world, [easting, visibleNorth])], line(easting)).addTo(group)
    L.marker(projectPoint(world, [easting, worldSize]), { pane: 'gridPane', interactive: false, keyboard: false, alt: '', icon: label(easting, 'easting') }).addTo(group)
  }
  for (let northing = Math.ceil(visibleSouth / interval) * interval; northing <= visibleNorth; northing += interval) {
    L.polyline([projectPoint(world, [visibleWest, northing]), projectPoint(world, [visibleEast, northing])], line(northing)).addTo(group)
    L.marker(projectPoint(world, [0, northing]), { pane: 'gridPane', interactive: false, keyboard: false, alt: '', icon: label(northing, 'northing') }).addTo(group)
  }
}

export function isDeleteShortcut(event: Pick<KeyboardEvent, 'key' | 'target'>) {
  return event.key === 'Delete' && !(event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]'))
}

export function pointDistance(a: Point, b: Point) { return Math.hypot(b[0] - a[0], b[1] - a[1]) }

export function milHeading(a: Point, b: Point) {
  return (Math.round(Math.atan2(b[0] - a[0], b[1] - a[1]) * 3200 / Math.PI) + 6400) % 6400
}

export function measurementHTML(kind: 'measure' | 'radius', points: [Point, Point]) {
  const distance = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(pointDistance(points[0], points[1]))
  return kind === 'radius' ? `Radius ${distance} m` : `${distance} m<br>${milHeading(points[0], points[1])} mil`
}

export function applyCategories(map: MapLibreMap | undefined, categories: Record<string, boolean>) {
  if (!map?.isStyleLoaded()) return
  for (const layer of map.getStyle().layers ?? []) {
    const category = mapDetailCategory(layer)
    if (category && category in categories) map.setLayoutProperty(layer.id, 'visibility', categories[category] ? 'visible' : 'none')
  }
}

export function mapDetailCategory(layer: LayerSpecification) {
  const explicit = String((layer.metadata as { category?: string } | undefined)?.category ?? '').toLowerCase()
  if (['terrain', 'roads', 'buildings', 'vegetation', 'labels'].includes(explicit)) return explicit
  if (layer.type === 'symbol') return 'labels'
  if (layer.type === 'background' || layer.type === 'raster') return 'terrain'
  const source = String((layer as LayerSpecification & { 'source-layer'?: string })['source-layer'] ?? layer.id).toLowerCase()
  if (['road', 'main_road', 'track', 'runway'].includes(source)) return 'roads'
  if (source === 'house') return 'buildings'
  if (['forest', 'tree'].includes(source)) return 'vegetation'
  if (source === 'sea' || source === 'rocks' || source === 'mount' || source.startsWith('contours')) return 'terrain'
}

function escapeHTML(value: string) { return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character) }
export function remoteCursorHTML(name: string) { return `<i class="pointer-dot"></i><span>${escapeHTML(name)}</span>` }
export function syncRemoteCursors(markers: Map<string, RemoteCursorMarker>, cursors: Record<string, RemoteCursor>, create: (cursor: RemoteCursor) => RemoteCursorMarker, project: (point: Point) => L.LatLngExpression = toLeaflet) {
  for (const [id, cursor] of Object.entries(cursors)) {
    const marker = markers.get(id)
    if (marker) marker.setLatLng(project(cursor.point))
    else markers.set(id, create(cursor))
  }
  for (const [id, marker] of markers) {
    if (!(id in cursors)) { marker.remove(); markers.delete(id) }
  }
}
export function markerHTML(annotation: Pick<Annotation, 'icon' | 'color' | 'label' | 'rotation' | 'scale'>, selected = false) {
  const url = markerImageURL(annotation.icon ?? 'mil_dot', annotation.color)
  const rotation = Number.isFinite(annotation.rotation) ? annotation.rotation ?? 0 : 0
  const scale = Number.isFinite(annotation.scale) && (annotation.scale ?? 0) > 0 ? annotation.scale ?? 1 : 1
  const label = annotation.label ? `<span style="color:${cssColor(annotation.color)}">${escapeHTML(annotation.label)}</span>` : ''
  const control = selected ? `<i class="rotation-control" style="transform:rotate(${rotation}deg)"></i>` : ''
  return `${control}<img src="${url}" alt="" referrerpolicy="no-referrer" style="transform:rotate(${rotation}deg) scale(${scale})">${label}`
}
export function markerRotation(origin: { x: number; y: number }, target: { x: number; y: number }) {
  return Math.round((Math.atan2(target.x - origin.x, origin.y - target.y) * 180 / Math.PI + 360) % 360) % 360
}
export function cssColor(color: string) { return ({ ColorBlack: '#111', ColorGrey: '#6b7280', ColorRed: '#ef4444', ColorBrown: '#92400e', ColorOrange: '#f97316', ColorYellow: '#eab308', ColorKhaki: '#a3a35b', ColorGreen: '#22c55e', ColorBlue: '#3b82f6', ColorPink: '#ec4899', ColorWhite: '#fff', ColorUNKNOWN: '#f97316', colorBLUFOR: '#2563eb', colorOPFOR: '#dc2626', colorIndependent: '#16a34a', colorCivilian: '#9333ea' } as Record<string, string>)[color] ?? '#f97316' }
