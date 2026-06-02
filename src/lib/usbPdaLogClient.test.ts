import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadUsbPdaLogArchive, isUsbPdaLogImportAvailable } from './usbPdaLogClient'
import * as webUsbClient from './webUsbPdaLogClient'

describe('downloadUsbPdaLogArchive', () => {
  afterEach(() => {
    vi.restoreAllMocks()
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

  it('does not request the local USB endpoint outside local development when WebUSB is unavailable', async () => {
    const fetch = vi.fn()
    vi.spyOn(webUsbClient, 'isWebUsbPdaLogImportAvailable').mockReturnValue(false)
    vi.stubGlobal('fetch', fetch)

    expect(isUsbPdaLogImportAvailable('log.fasong.xyz')).toBe(false)
    await expect(downloadUsbPdaLogArchive('log.fasong.xyz')).rejects.toThrow(
      '当前浏览器不支持 WebUSB',
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it('uses WebUSB outside local development when the browser supports it', async () => {
    const archive = {
      blob: new Blob(['zip'], { type: 'application/zip' }),
      sourceName: 'WEBUSB_MTM_1696955_2026-06-02_08-01-02.zip',
    }
    const fetch = vi.fn()
    vi.spyOn(webUsbClient, 'isWebUsbPdaLogImportAvailable').mockReturnValue(true)
    vi.spyOn(webUsbClient, 'downloadWebUsbPdaLogArchive').mockResolvedValue(archive)
    vi.stubGlobal('fetch', fetch)

    await expect(downloadUsbPdaLogArchive('log.fasong.xyz')).resolves.toEqual(archive)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('falls back to the local USB endpoint on localhost when WebUSB fails', async () => {
    const blob = new Blob(['zip'], { type: 'application/zip' })
    vi.spyOn(webUsbClient, 'isWebUsbPdaLogImportAvailable').mockReturnValue(true)
    vi.spyOn(webUsbClient, 'downloadWebUsbPdaLogArchive').mockRejectedValue(new Error('WebUSB permission failed'))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(blob, {
        status: 200,
        headers: { 'content-disposition': 'attachment; filename="EXPORT_MTM_1696955_2026-06-02_08-01-02.zip"' },
      })),
    )

    await expect(downloadUsbPdaLogArchive('localhost')).resolves.toEqual({
      blob,
      sourceName: 'EXPORT_MTM_1696955_2026-06-02_08-01-02.zip',
      password: undefined,
    })
  })
})
