import { describe, expect, it } from 'vitest'
import {
  createWebUsbExportName,
  createWebUsbPdaLogErrorMessage,
  selectWebUsbPdaLogEntries,
  streamToBlob,
  type WebUsbPdaLogEntry,
} from './webUsbPdaLogClient'

describe('selectWebUsbPdaLogEntries', () => {
  it('selects only yyyy-MM-dd logs from the latest five local days and skips files over 100 MB', () => {
    const entries: WebUsbPdaLogEntry[] = [
      { name: '2026-05-28', size: 12 },
      { name: '2026-05-29', size: 100 * 1024 * 1024 + 1 },
      { name: '2026-05-30', size: 1022375 },
      { name: '2026-05-31', size: 857351 },
      { name: '2026-06-01', size: 7298569 },
      { name: '2026-06-02', size: 28601778 },
      { name: 'PDA_D00001_Patch Pump PDA_version3.0.0_.zip', size: 9501328 },
      { name: 'password_info.txt', size: 294 },
    ]

    expect(selectWebUsbPdaLogEntries(entries, new Date('2026-06-02T09:00:00.000Z'))).toEqual([
      { name: '2026-05-30', size: 1022375 },
      { name: '2026-05-31', size: 857351 },
      { name: '2026-06-01', size: 7298569 },
      { name: '2026-06-02', size: 28601778 },
    ])
  })
})

describe('createWebUsbExportName', () => {
  it('creates a stable zip name for browser WebUSB exports', () => {
    expect(createWebUsbExportName('1696955', new Date('2026-06-02T08:01:02.000Z'))).toBe(
      'WEBUSB_MTM_1696955_2026-06-02_08-01-02.zip',
    )
  })
})

describe('streamToBlob', () => {
  it('converts a byte stream into a blob', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]))
        controller.enqueue(new Uint8Array([3]))
        controller.close()
      },
    })

    const blob = await streamToBlob(stream)

    await expect(blob.arrayBuffer()).resolves.toEqual(new Uint8Array([1, 2, 3]).buffer)
  })
})

describe('createWebUsbPdaLogErrorMessage', () => {
  it('explains when another program already owns the ADB USB interface', () => {
    expect(createWebUsbPdaLogErrorMessage(new Error('The device is already in used by another program'))).toContain(
      '设备已被其他程序占用',
    )
  })
})
