export type Point = [easting: number, northing: number]

export type User = { id: string; username: string; displayName: string; avatar?: string; admin: boolean }
export type Annotation = {
  id: string
  mapId: string
  layerId: string
  kind: 'marker' | 'polyline' | 'freehand' | 'measure' | 'radius' | 'note'
  position: number
  color: string
  points?: Point[]
  point?: Point
  icon?: string
  label?: string
  text?: string
  rotation?: number
  scale?: number
}
export type Layer = { id: string; mapId: string; name: string; position: number; annotations?: Annotation[] }
export type TacMap = {
  id: string
  name: string
  world: string
  creatorId: string
  creator?: User
  version: number
  createdAt?: number
  deleted: boolean
  worldAvailable: boolean
  layers: Layer[]
}
export type World = { name: string; size: number; styles: string[]; format: 'pmtiles' | 'raster'; maxZoom?: number; preview?: string; hasMeta: boolean }
export type AdminWorld = { name: string; valid: boolean; validationError: string; format?: 'pmtiles' | 'raster'; styles?: string[]; activeMaps: number; trashedMaps: number; ready: boolean; size?: number }
export type Revision = { id: number; mapId: string; version: number; actor: User; kind: string; data?: { annotation?: Annotation; snapshot?: TacMap }; createdAt: number }
export type SocketMessage = {
  type: 'snapshot' | 'mutation' | 'acknowledgement' | 'error' | 'presence' | 'cursor'
  version?: number
  operation?: 'create' | 'update' | 'delete'
  annotation?: Annotation
  id?: string
  actor?: User
  map?: TacMap
  cursor?: Point | null
  message?: string
}
