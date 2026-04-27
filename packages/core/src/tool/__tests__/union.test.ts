import { describe, expect, it } from 'vitest'
import { unionByName } from '../union'

describe('unionByName', () => {
  it('returns undefined when both inputs are undefined', () => {
    expect(unionByName(undefined, undefined)).toBeUndefined()
  })

  it('returns base when only base is defined', () => {
    const base = [{ name: 'a', value: 1 }]
    const result = unionByName(base, undefined)
    expect(result).toEqual([{ name: 'a', value: 1 }])
  })

  it('returns override when only override is defined', () => {
    const override = [{ name: 'b', value: 2 }]
    const result = unionByName(undefined, override)
    expect(result).toEqual([{ name: 'b', value: 2 }])
  })

  it('override wins on same-name conflict', () => {
    const base = [{ name: 'x', value: 'base' }]
    const override = [{ name: 'x', value: 'override' }]
    const result = unionByName(base, override)
    expect(result).toEqual([{ name: 'x', value: 'override' }])
  })

  it('keeps disjoint names from both sides', () => {
    const base = [{ name: 'a', value: 1 }]
    const override = [{ name: 'b', value: 2 }]
    const result = unionByName(base, override)
    expect(result).toHaveLength(2)
    expect(result).toContainEqual({ name: 'a', value: 1 })
    expect(result).toContainEqual({ name: 'b', value: 2 })
  })

  it('returns empty array when both sides are empty arrays', () => {
    const result = unionByName([], [])
    expect(result).toEqual([])
  })

  it('preserves base order for non-conflicting entries, then appends new override entries', () => {
    const base = [{ name: 'a', v: 1 }, { name: 'b', v: 2 }]
    const override = [{ name: 'b', v: 20 }, { name: 'c', v: 3 }]
    const result = unionByName(base, override)
    expect(result).toEqual([
      { name: 'a', v: 1 },
      { name: 'b', v: 20 },
      { name: 'c', v: 3 },
    ])
  })
})
