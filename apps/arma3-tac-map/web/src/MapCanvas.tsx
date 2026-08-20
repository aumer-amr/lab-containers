import '@geoman-io/leaflet-geoman-free'
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css'
import '@maplibre/maplibre-gl-leaflet'
import 'leaflet/dist/leaflet.css'
import 'maplibre-gl/dist/maplibre-gl.css'
import L from 'leaflet'
import maplibregl, { type Map as MapLibreMap, type StyleSpecification } from 'maplibre-gl'
import { Protocol } from 'pmtiles'
import { useEffect, useRef } from 'react'
import { toArma, toLeaflet } from './state'
import type { RemoteCursor } from './state'
import type { Annotation, Point, World } from './types'

const protocol = new Protocol()
maplibregl.addProtocol('pmtiles', protocol.tile)

type GeomanMap = L.Map & { pm: { enableDraw(shape: 'Marker' | 'Line', options?: object): void; disableDraw(): void } }
type MapLibreLayer = L.Layer & { getMaplibreMap(): MapLibreMap }
type LeafletWithMapLibre = typeof L & { maplibreGL(options: { style: StyleSpecification }): MapLibreLayer }
type EditableLayer = L.Layer & { pm?: { enable(): void } }

type Props = {
  world: World
  style: string
  categories: Record<string, boolean>
  annotations: Annotation[]
  cursors: Record<string, RemoteCursor>
  editing: boolean
  layerID: string
  kind: 'marker' | 'polyline' | 'freehand'
  color: string
  icon: string
  label: string
  rotation: number
  scale: number
  onCreate(annotation: Omit<Annotation, 'id' | 'mapId'>): void
  onUpdate(annotation: Annotation): void
  onDelete(id: string): void
  onCursor(point: Point): void
}

async function loadStyle(world: string, style: string): Promise<StyleSpecification> {
  const prefix = `/api/worlds/${encodeURIComponent(world)}/assets/`
  const response = await fetch(`${prefix}styles/${encodeURIComponent(style)}.json`)
  if (!response.ok) throw new Error('Terrain style unavailable')
  const value = await response.json() as Record<string, unknown>
  const rewrite = (item: unknown): unknown => {
    if (typeof item === 'string') {
      if (item.startsWith('pmtiles://')) return `pmtiles://${location.origin}${prefix}${item.slice('pmtiles://'.length).replace(/^\.\//, '')}`
      if (item.startsWith('fonts/')) return `/api/assets/fonts/${item.slice('fonts/'.length)}`
      if (item.startsWith('sprites/')) return `${prefix}${item}`
      return item
    }
    if (Array.isArray(item)) return item.map(rewrite)
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, rewrite(child)]))
    return item
  }
  return rewrite(value) as StyleSpecification
}

export function MapCanvas(props: Props) {
  const element = useRef<HTMLDivElement>(null)
  const mapRef = useRef<GeomanMap | null>(null)
  const terrainRef = useRef<MapLibreLayer | null>(null)
  const annotationGroup = useRef<L.LayerGroup | null>(null)
  const cursorGroup = useRef<L.LayerGroup | null>(null)
  const current = useRef(props)
  current.current = props

  useEffect(() => {
    if (!element.current) return
    const map = L.map(element.current, { crs: L.CRS.Simple, minZoom: -5, maxZoom: 5, zoomControl: true }) as GeomanMap
    map.fitBounds([[0, 0], [props.world.size, props.world.size]])
    annotationGroup.current = L.layerGroup().addTo(map)
    cursorGroup.current = L.layerGroup().addTo(map)
    map.on('pm:create', (event: L.LeafletEvent & { layer: L.Layer }) => {
      const layer = event.layer
      const settings = current.current
      if (layer instanceof L.Marker) {
        settings.onCreate({ layerId: settings.layerID, kind: 'marker', position: Date.now(), color: settings.color, point: toArma([layer.getLatLng().lat, layer.getLatLng().lng]), icon: settings.icon, label: settings.label, rotation: settings.rotation, scale: settings.scale })
      } else if (layer instanceof L.Polyline) {
        const points = (layer.getLatLngs() as L.LatLng[]).map(({ lat, lng }) => toArma([lat, lng]))
        settings.onCreate({ layerId: settings.layerID, kind: settings.kind === 'freehand' ? 'freehand' : 'polyline', position: Date.now(), color: settings.color, points })
      }
      layer.remove()
    })
    let lastCursor = 0
    map.on('mousemove', (event: L.LeafletMouseEvent) => {
      const now = performance.now()
      if (now - lastCursor >= 100) { lastCursor = now; current.current.onCursor(toArma([event.latlng.lat, event.latlng.lng])) }
    })
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [props.world.name, props.world.size])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    let cancelled = false
    loadStyle(props.world.name, props.style).then((style) => {
      if (cancelled) return
      terrainRef.current?.remove()
      terrainRef.current = (L as LeafletWithMapLibre).maplibreGL({ style }).addTo(map) as MapLibreLayer
      terrainRef.current.getMaplibreMap().once('load', () => applyCategories(terrainRef.current?.getMaplibreMap(), current.current.categories))
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [props.style, props.world.name])

  useEffect(() => applyCategories(terrainRef.current?.getMaplibreMap(), props.categories), [props.categories])

  useEffect(() => {
    const group = annotationGroup.current
    if (!group) return
    group.clearLayers()
    for (const annotation of props.annotations) {
      let layer: L.Layer
      if (annotation.kind === 'marker' && annotation.point) {
        layer = L.marker(toLeaflet(annotation.point), { icon: L.divIcon({ className: `mil-marker ${annotation.color}`, html: `<span title="${escapeHTML(annotation.label ?? '')}">${escapeHTML(annotation.icon ?? 'mil_dot')}</span>` }) })
      } else {
        layer = L.polyline((annotation.points ?? []).map(toLeaflet), { color: cssColor(annotation.color), weight: 4 })
      }
      layer.on('contextmenu', () => { if (current.current.editing && confirm('Delete annotation?')) current.current.onDelete(annotation.id) })
      layer.on('click', () => { if (current.current.editing) (layer as EditableLayer).pm?.enable() })
      layer.on('pm:edit', () => {
        if (layer instanceof L.Marker) current.current.onUpdate({ ...annotation, point: toArma([layer.getLatLng().lat, layer.getLatLng().lng]) })
        if (layer instanceof L.Polyline) current.current.onUpdate({ ...annotation, points: (layer.getLatLngs() as L.LatLng[]).map(({ lat, lng }) => toArma([lat, lng])) })
      })
      group.addLayer(layer)
    }
  }, [props.annotations])

  useEffect(() => {
    const group = cursorGroup.current
    if (!group) return
    group.clearLayers()
    for (const { user, point } of Object.values(props.cursors)) {
      L.marker(toLeaflet(point), { interactive: false, icon: L.divIcon({ className: 'remote-cursor', html: `<span>${escapeHTML(user.displayName)}</span>` }) }).addTo(group)
    }
  }, [props.cursors])

  const draw = (shape: 'Marker' | 'Line') => {
    if (!props.editing) return
    mapRef.current?.pm.disableDraw()
    mapRef.current?.pm.enableDraw(shape, shape === 'Line' ? { finishOn: 'dblclick' } : undefined)
  }

  const drawFreehand = () => {
    const map = mapRef.current
    if (!map || !props.editing) return
    map.pm.disableDraw()
    const points: Point[] = []
    const move = (event: L.LeafletMouseEvent) => points.push(toArma([event.latlng.lat, event.latlng.lng]))
    const finish = () => {
      map.off('mousemove', move)
      map.dragging.enable()
      if (points.length >= 2) props.onCreate({ layerId: props.layerID, kind: 'freehand', position: 0, color: props.color, points })
    }
    map.once('mousedown', (event: L.LeafletMouseEvent) => { map.dragging.disable(); points.push(toArma([event.latlng.lat, event.latlng.lng])); map.on('mousemove', move); map.once('mouseup', finish) })
  }

  return <section className="map-panel" aria-label="Tactical map editor">
    <div className="draw-tools" aria-label="Annotation tools">
      <button disabled={!props.editing} onClick={() => draw('Marker')}>Place marker</button>
      <button disabled={!props.editing} onClick={() => props.kind === 'freehand' ? drawFreehand() : draw('Line')}>{props.kind === 'freehand' ? 'Draw stroke' : 'Draw line'}</button>
      {!props.editing && <span className="connection-warning">Editing disabled while disconnected or terrain is missing.</span>}
    </div>
    <div className="map" ref={element} />
  </section>
}

function applyCategories(map: MapLibreMap | undefined, categories: Record<string, boolean>) {
  if (!map?.isStyleLoaded()) return
  for (const layer of map.getStyle().layers ?? []) {
    const metadata = layer.metadata as { category?: string } | undefined
    const category = String(metadata?.category ?? layer.id.split(/[-_/]/)[0]).toLowerCase()
    if (category in categories) map.setLayoutProperty(layer.id, 'visibility', categories[category] ? 'visible' : 'none')
  }
}

function escapeHTML(value: string) { return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character) }
function cssColor(color: string) { return ({ ColorRed: '#ef4444', ColorBlue: '#3b82f6', ColorGreen: '#22c55e', ColorYellow: '#eab308', ColorWhite: '#fff', ColorBlack: '#111', colorBLUFOR: '#2563eb', colorOPFOR: '#dc2626', colorIndependent: '#16a34a', colorCivilian: '#9333ea' } as Record<string, string>)[color] ?? '#f97316' }
