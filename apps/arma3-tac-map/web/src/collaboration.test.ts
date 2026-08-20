import { describe, expect, it } from 'vitest'
import { reconnectDelay } from './collaboration'

describe('reconnectDelay', () => {
  it('backs off reconnects and caps delay at ten seconds', () => {
    expect([0, 1, 2, 10].map(reconnectDelay)).toEqual([1000, 2000, 4000, 10000])
  })
})
