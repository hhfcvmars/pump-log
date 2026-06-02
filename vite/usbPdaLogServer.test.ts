import { describe, expect, it } from 'vitest'
import {
  createUsbExportName,
  parseAdbDevices,
  parsePasswordInfo,
  parseRemoteDateLogEntries,
  selectRecentDateLogs,
} from './usbPdaLogServer'

describe('parseAdbDevices', () => {
  it('parses authorized ADB devices with model and product data', () => {
    const devices = parseAdbDevices(`List of devices attached
1696955                device usb:18087936X product:Patch Pump PDA model:Patch_Pump_PDA device:Patch Pump PDA transport_id:7
`)

    expect(devices).toEqual([
      {
        serial: '1696955',
        state: 'device',
        product: 'Patch Pump PDA',
        model: 'Patch_Pump_PDA',
      },
    ])
  })

  it('keeps unauthorized devices so the caller can report them', () => {
    const devices = parseAdbDevices(`List of devices attached
abc123 unauthorized
`)

    expect(devices).toEqual([
      {
        serial: 'abc123',
        state: 'unauthorized',
      },
    ])
  })
})

describe('createUsbExportName', () => {
  it('creates a stable zip name with serial and timestamp', () => {
    expect(createUsbExportName('1696955', new Date('2026-06-02T08:01:02.000Z'))).toBe(
      'EXPORT_MTM_1696955_2026-06-02_08-01-02.zip',
    )
  })
})

describe('parsePasswordInfo', () => {
  it('extracts archive name, password, serial number, and version', () => {
    const info = parsePasswordInfo(`=== PDA 日志压缩包密码信息 ===
压缩包文件: PDA_D00001_Patch Pump PDA_version3.0.0_.zip
PDA序列号: D00001
设备信息: Patch Pump PDA
应用版本: 3.0.0
创建时间: 2026-06-02 13:49:50
压缩包密码: PDA_D00001
注意：请妥善保管此密码，用于解压日志文件
`)

    expect(info).toEqual({
      archiveName: 'PDA_D00001_Patch Pump PDA_version3.0.0_.zip',
      serialNumber: 'D00001',
      version: '3.0.0',
      password: 'PDA_D00001',
    })
  })
})

describe('selectRecentDateLogs', () => {
  it('selects only yyyy-MM-dd logs from the latest five local days and skips files over 100 MB', () => {
    const entries = parseRemoteDateLogEntries(`total 1728952
drwxrwx--x 2 system sdcard_rw      4096 2026-06-02 13:49 .
drwxrwx--x 3 system sdcard_rw      4096 2026-06-02 15:23 ..
-rw-rw---- 1 system sdcard_rw 365561360 2026-05-21 23:59 2026-05-21
-rw-rw---- 1 system sdcard_rw 468632524 2026-05-22 23:59 2026-05-22
-rw-rw---- 1 system sdcard_rw    646069 2026-05-23 23:59 2026-05-23
-rw-rw---- 1 system sdcard_rw   1022375 2026-05-30 23:59 2026-05-30
-rw-rw---- 1 system sdcard_rw    857351 2026-05-31 23:59 2026-05-31
-rw-rw---- 1 system sdcard_rw   7298569 2026-06-01 23:59 2026-06-01
-rw-rw---- 1 system sdcard_rw  28601778 2026-06-02 16:59 2026-06-02
-rw-rw---- 1 system sdcard_rw 105906177 2026-05-29 23:59 2026-05-29
-rw-rw---- 1 system sdcard_rw   9501328 2026-06-02 13:49 PDA_D00001_Patch Pump PDA_version3.0.0_.zip
-rw-rw---- 1 system sdcard_rw       294 2026-06-02 13:49 password_info.txt
`)

    expect(selectRecentDateLogs(entries, new Date('2026-06-02T09:00:00.000Z'))).toEqual([
      { name: '2026-05-30', size: 1022375 },
      { name: '2026-05-31', size: 857351 },
      { name: '2026-06-01', size: 7298569 },
      { name: '2026-06-02', size: 28601778 },
    ])
  })
})
