import { describe, expect, it } from 'vitest'
import { getXLogTextDownloadName } from './downloadName'

describe('getXLogTextDownloadName', () => {
  it('renames xlog files to txt downloads', () => {
    expect(getXLogTextDownloadName('Pump_20260520.xlog')).toBe('Pump_20260520.txt')
  })

  it('handles uppercase xlog extensions', () => {
    expect(getXLogTextDownloadName('Pump_20260520.XLOG')).toBe('Pump_20260520.txt')
  })
})
