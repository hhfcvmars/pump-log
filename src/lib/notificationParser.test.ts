import { describe, expect, it } from 'vitest'
import {
  buildPassword,
  inferArchiveMetadata,
  parseUploadNotification,
} from './notificationParser'

const sampleNotification = `[vcs]2026-05-22 11:21:57
uploadLog, fileName: PDA_MTM-Z2_D00001_Patch Pump PDA_version2.3.0_.zip, urlPath: https://d3ci4jgewizada.cloudfront.net/vcs/eu/errorlog/cgms/PDA_MTM-Z2_D00001_Patch+Pump+PDA_version2.3.0_.zip`

const vcsCgmsNotification = `[vcs]2026-05-21 11:46:00
uploadLog, fileName: Lumipod_android_45f5660d96bff674f6a686f375005e4d_D0040A_LUMI123457_2.2.0.zip, urlPath: https://d3ci4jgewizada.cloudfront.net/vcs/eu/errorlog/cgms/Lumipod_android_45f5660d96bff674f6a686f375005e4d_D0040A_LUMI123457_2.2.0.zip`

describe('parseUploadNotification', () => {
  it('extracts upload metadata and derives the PDA password', () => {
    const parsed = parseUploadNotification(sampleNotification)

    expect(parsed).toEqual({
      uploadedAt: '2026-05-22 11:21:57',
      fileName: 'PDA_MTM-Z2_D00001_Patch Pump PDA_version2.3.0_.zip',
      urlPath:
        'https://d3ci4jgewizada.cloudfront.net/vcs/eu/errorlog/cgms/PDA_MTM-Z2_D00001_Patch+Pump+PDA_version2.3.0_.zip',
      serialNumber: 'D00001',
      version: '2.3.0',
      password: 'PDA_D00001',
    })
  })

  it('returns an error when the notification is missing the URL', () => {
    const parsed = parseUploadNotification('uploadLog, fileName: foo.zip')

    expect(parsed.error).toBe('未找到 urlPath 字段')
  })

  it('returns an error when the notification is missing the file name', () => {
    const parsed = parseUploadNotification('uploadLog, urlPath: https://example.com/foo.zip')

    expect(parsed.error).toBe('未找到 fileName 字段')
  })

  it('parses non-PDA vcs/cgms upload notifications without a password', () => {
    const parsed = parseUploadNotification(vcsCgmsNotification)

    expect(parsed).toMatchObject({
      uploadedAt: '2026-05-21 11:46:00',
      fileName: 'Lumipod_android_45f5660d96bff674f6a686f375005e4d_D0040A_LUMI123457_2.2.0.zip',
      urlPath: 'https://d3ci4jgewizada.cloudfront.net/vcs/eu/errorlog/cgms/Lumipod_android_45f5660d96bff674f6a686f375005e4d_D0040A_LUMI123457_2.2.0.zip',
      serialNumber: 'D0040A',
      version: '2.2.0',
      password: '',
    })
  })
})

describe('inferArchiveMetadata', () => {
  it('infers metadata from a local archive file name', () => {
    expect(
      inferArchiveMetadata('PDA_MTM-Z2_D00001_Patch Pump PDA_version2.3.0_.zip'),
    ).toEqual({
      fileName: 'PDA_MTM-Z2_D00001_Patch Pump PDA_version2.3.0_.zip',
      serialNumber: 'D00001',
      version: '2.3.0',
      password: 'PDA_D00001',
    })
  })

  it('decodes plus signs and URL encoded spaces before inference', () => {
    expect(
      inferArchiveMetadata(
        'PDA_MTM-Z2_D00001_Patch+Pump+PDA_version2.3.0_.zip',
      ).fileName,
    ).toBe('PDA_MTM-Z2_D00001_Patch Pump PDA_version2.3.0_.zip')
  })

  it('keeps non-PDA vcs/cgms archives passwordless', () => {
    const meta = inferArchiveMetadata(
      'Lumipod_android_45f5660d96bff674f6a686f375005e4d_D0040A_LUMI123457_2.2.0.zip',
    )

    expect(meta).toMatchObject({
      serialNumber: 'D0040A',
      version: '2.2.0',
      password: '',
    })
  })

  it('requires a PDA password only for PDA_MTM archives', () => {
    const meta = inferArchiveMetadata(
      'PDA_MTM-Z2_D00099_Patch Pump PDA_version3.0.0_.zip',
    )

    expect(meta).toMatchObject({
      serialNumber: 'D00099',
      version: '3.0.0',
      password: 'PDA_D00099',
    })
  })
})

describe('buildPassword', () => {
  it('builds a PDA password when the serial number is known', () => {
    expect(buildPassword('D00001')).toBe('PDA_D00001')
  })

  it('returns an empty password when the serial number is not known', () => {
    expect(buildPassword()).toBe('')
  })
})
