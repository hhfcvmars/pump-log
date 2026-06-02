import { describe, expect, it } from 'vitest'
import { calculateVirtualWindow } from './virtualLog'

describe('calculateVirtualWindow', () => {
  it('returns an empty window for empty input', () => {
    expect(calculateVirtualWindow(0, 0, 400, 22, 20)).toEqual({
      start: 0,
      end: 0,
      offsetTop: 0,
      totalHeight: 0,
    })
  })

  it('keeps the initial render small with overscan', () => {
    expect(calculateVirtualWindow(100_000, 0, 440, 22, 20)).toEqual({
      start: 0,
      end: 40,
      offsetTop: 0,
      totalHeight: 2_200_000,
    })
  })

  it('calculates a middle window from scroll position', () => {
    expect(calculateVirtualWindow(100_000, 22_000, 440, 22, 20)).toEqual({
      start: 980,
      end: 1_040,
      offsetTop: 21_560,
      totalHeight: 2_200_000,
    })
  })

  it('clamps the window near the end', () => {
    expect(calculateVirtualWindow(100, 2_000, 220, 22, 20)).toEqual({
      start: 70,
      end: 100,
      offsetTop: 1_540,
      totalHeight: 2_200,
    })
  })
})
