import { describe, expect, it } from 'vitest'
import { annotationReducer, canManageMap, cursorReducer, editingEnabled, initialVisibility, toArma, toLeaflet, visibleLayerIDs } from './state'
import type { TacMap, User } from './types'

const owner: User = { id: 'owner', username: 'owner', displayName: 'Owner', admin: false }
const map: TacMap = { id: 'map', name: 'Plan', world: 'altis', creatorId: owner.id, version: 1, deleted: false, worldAvailable: true, layers: [{ id: 'general', mapId: 'map', name: 'General', position: 0, annotations: [] }] }

describe('map state', () => {
  it('converts Arma metres to Web Mercator coordinates and back', () => {
    const leaflet = toLeaflet([4096, 4096])
    expect(leaflet[0]).toBeCloseTo(0.0368, 3)
    expect(leaflet[1]).toBeCloseTo(0.0368, 3)
    expect(toArma(leaflet)[0]).toBeCloseTo(4096)
    expect(toArma(leaflet)[1]).toBeCloseTo(4096)
  })

  it('applies authoritative snapshot and mutation versions', () => {
    const annotation = { id: 'a', mapId: map.id, layerId: 'general', kind: 'marker' as const, position: 0, color: 'ColorBlue', point: [10, 20] as [number, number], icon: 'mil_dot', scale: 1 }
    const changed = annotationReducer(map, { type: 'mutation', operation: 'create', version: 2, annotation })
    expect(changed?.version).toBe(2)
    expect(changed?.layers[0].annotations).toEqual([annotation])
    expect(annotationReducer(changed, { type: 'snapshot', map: { ...map, version: 9 } })?.version).toBe(9)
  })

  it('keeps visibility local and uses visible layers as export defaults', () => {
    const visibility = initialVisibility([...map.layers, { id: 'hidden', mapId: map.id, name: 'Hidden', position: 1 }])
    visibility.hidden = false
    expect(visibleLayerIDs(visibility)).toEqual(['general'])
  })

  it('gates management and editing permissions', () => {
    expect(canManageMap(owner, map)).toBe(true)
    expect(canManageMap({ ...owner, id: 'other' }, map)).toBe(false)
    expect(canManageMap({ ...owner, id: 'admin', admin: true }, map)).toBe(true)
    expect(editingEnabled(false, map)).toBe(false)
    expect(editingEnabled(true, { ...map, worldAvailable: false })).toBe(false)
  })

  it('tracks cursors and removes them when pointing ends or users leave', () => {
    const present = cursorReducer({}, { type: 'cursor', actor: owner, cursor: [7, 8] })
    expect(present.owner.point).toEqual([7, 8])
    expect(cursorReducer(present, { type: 'cursor', actor: owner, cursor: null })).toEqual({})
    expect(cursorReducer(present, { type: 'presence', actor: owner, message: 'left' })).toEqual({})
  })
})
