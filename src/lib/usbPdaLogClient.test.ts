import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadUsbPdaLogArchive, isUsbPdaLogImportAvailable } from './usbPdaLogClient'

describe('downloadUsbPdaLogArchive', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the archive blob, source name, and password from response headers', async () => {
    const blob = new Blob(['zip'], { type: 'application/zip' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(blob, {
        status: 200,
        headers: {
          'content-disposition': 'attachment; filename="PDA_D00001_Patch Pump PDA_version3.0.0_.zip"',
          'x-pda-log-password': 'PDA_D00001',
        },
      })),
    )

    await expect(downloadUsbPdaLogArchive('localhost')).resolves.toEqual({
      blob,
      sourceName: 'PDA_D00001_Patch Pump PDA_version3.0.0_.zip',
      password: 'PDA_D00001',
    })
  })

  it('throws the server-provided error message on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: '未检测到已授权的 ADB 设备' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      })),
    )

    await expect(downloadUsbPdaLogArchive('localhost')).rejects.toThrow('未检测到已授权的 ADB 设备')
  })

  it('does not request the USB endpoint outside local development', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)

    expect(isUsbPdaLogImportAvailable('log.fasong.xyz')).toBe(false)
    await expect(downloadUsbPdaLogArchive('log.fasong.xyz')).rejects.toThrow(
      'USB 导入仅支持在本机运行 npm run dev 时使用',
    )
    expect(fetch).not.toHaveBeenCalled()
  })
})
