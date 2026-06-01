import { describe, expect, it } from 'vitest'
import { createDownloadErrorMessage } from './archiveReader'

describe('createDownloadErrorMessage', () => {
  it('explains browser download failures with a local import fallback', () => {
    expect(createDownloadErrorMessage('https://example.com/log.zip')).toContain(
      '请先手动下载 zip 后用本地导入',
    )
  })
})
