import type { Annotation, Layer, Point, SocketMessage, TacMap, User } from './types'

export type RemoteCursor = { user: User; point: Point }
export type CursorState = Record<string, RemoteCursor>

export function cursorReducer(state: CursorState, message: SocketMessage): CursorState {
  if (!message.actor) return state
  if (message.type === 'cursor' && message.cursor) return { ...state, [message.actor.id]: { user: message.actor, point: message.cursor } }
  if (message.type === 'presence' && message.message === 'left') {
    const next = { ...state }
    delete next[message.actor.id]
    return next
  }
  return state
}

export const toLeaflet = ([easting, northing]: Point): [number, number] => [northing, easting]
export const toArma = ([latitude, longitude]: [number, number]): Point => [longitude, latitude]

export function annotationReducer(state: TacMap | null, message: SocketMessage): TacMap | null {
  if (message.type === 'snapshot') return message.map ?? state
  if (message.type !== 'mutation' || !state || !message.operation || !message.version) return state
  const layers = state.layers.map((layer) => ({ ...layer, annotations: [...(layer.annotations ?? [])] }))
  if (message.operation === 'delete') {
    for (const layer of layers) layer.annotations = layer.annotations?.filter(({ id }) => id !== message.id)
  } else if (message.annotation) {
    for (const layer of layers) layer.annotations = layer.annotations?.filter(({ id }) => id !== message.annotation?.id)
    const target = layers.find(({ id }) => id === message.annotation?.layerId)
    if (target) target.annotations = [...(target.annotations ?? []), message.annotation]
  }
  return { ...state, layers, version: message.version }
}

export function initialVisibility(layers: Layer[]): Record<string, boolean> {
  return Object.fromEntries(layers.map(({ id }) => [id, true]))
}

export function visibleLayerIDs(visibility: Record<string, boolean>): string[] {
  return Object.entries(visibility).filter(([, visible]) => visible).map(([id]) => id)
}

export const canManageMap = (user: User, map: TacMap) => user.admin || user.id === map.creatorId
export const canRestore = (user: User) => user.admin
export const editingEnabled = (connected: boolean, map: TacMap) => connected && map.worldAvailable && !map.deleted

export function flattenAnnotations(layers: Layer[], visibility: Record<string, boolean>): Annotation[] {
  return layers.filter(({ id }) => visibility[id] !== false).flatMap(({ annotations }) => annotations ?? [])
}
