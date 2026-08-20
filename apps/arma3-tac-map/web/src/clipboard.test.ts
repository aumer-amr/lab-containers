import { describe, expect, it, vi } from 'vitest'
import { copyText } from './clipboard'

describe('copyText', () => {
  it('uses selectable-text fallback when Clipboard API fails', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    const fallback = vi.fn()
    await expect(copyText('plan', fallback)).resolves.toBe(false)
    expect(fallback).toHaveBeenCalledOnce()
  })
})
