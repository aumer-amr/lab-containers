import Leaflet from 'leaflet'

globalThis.L = Leaflet

export const leafletPluginsReady = Promise.all([
  import('@geoman-io/leaflet-geoman-free'),
  import('@maplibre/maplibre-gl-leaflet'),
])
