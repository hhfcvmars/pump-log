import { describe, expect, it } from 'vitest'
import {
  createLogBundle,
  filterEntries,
  formatFileSize,
  getTextStats,
  isTextLikePath,
} from './logBundle'

describe('formatFileSize', () => {
  it('formats bytes, KB, and MB with compact units', () => {
    expect(formatFileSize(436)).toBe('436 B')
    expect(formatFileSize(762 * 1024)).toBe('762 KB')
    expect(formatFileSize(4.1 * 1024 * 1024)).toBe('4.1 MB')
  })
})

describe('isTextLikePath', () => {
  it('accepts common log and text paths', () => {
    expect(isTextLikePath('2026-05-01/logcat.log')).toBe(true)
    expect(isTextLikePath('password_info.txt')).toBe(true)
    expect(isTextLikePath('pump/status.json')).toBe(true)
  })

  it('rejects binary-like paths', () => {
    expect(isTextLikePath('capture.png')).toBe(false)
    expect(isTextLikePath('archive.zip')).toBe(false)
  })
})

describe('createLogBundle', () => {
  it('normalizes entries and sorts them by path', () => {
    const bundle = createLogBundle({
      sourceName: 'PDA_MTM-Z2_D00001.zip',
      password: 'PDA_D00001',
      entries: [
        {
          path: '2026-05-02/main.log',
          size: 3,
          lastModified: new Date('2026-05-02T14:40:00Z'),
          text: 'abc',
        },
        {
          path: '2026-05-01/error.bin',
          size: 2,
          lastModified: new Date('2026-05-01T23:59:00Z'),
        },
      ],
    })

    expect(bundle.entries.map((entry) => entry.path)).toEqual([
      '2026-05-01/error.bin',
      '2026-05-02/main.log',
    ])
    expect(bundle.entries[0]).toMatchObject({
      name: 'error.bin',
      extension: 'bin',
      typeLabel: '二进制/未知',
      canPreview: false,
      displaySize: '2 B',
    })
    expect(bundle.entries[1]).toMatchObject({
      name: 'main.log',
      extension: 'log',
      typeLabel: '日志',
      canPreview: true,
      displaySize: '3 B',
    })
  })
})

describe('filterEntries', () => {
  it('matches nested paths and file names case-insensitively', () => {
    const bundle = createLogBundle({
      sourceName: 'logs.zip',
      password: 'PDA_D00001',
      entries: [
        { path: '2026-05-02/Main.LOG', size: 1, text: 'x' },
        { path: '2026-05-01/status.json', size: 1, text: '{}' },
      ],
    })

    expect(filterEntries(bundle.entries, 'main')).toHaveLength(1)
    expect(filterEntries(bundle.entries, '2026-05-01')).toHaveLength(1)
    expect(filterEntries(bundle.entries, '')).toHaveLength(2)
  })
})

describe('getTextStats', () => {
  it('counts lines and characters for text previews', () => {
    expect(getTextStats('one\ntwo\nthree')).toEqual({
      lineCount: 3,
      characterCount: 13,
    })
  })

  it('returns zero counts when no text preview exists', () => {
    expect(getTextStats()).toEqual({
      lineCount: 0,
      characterCount: 0,
    })
  })
})
