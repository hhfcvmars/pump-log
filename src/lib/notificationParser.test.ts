import { describe, expect, it } from 'vitest'
import {
  buildPassword,
  inferArchiveMetadata,
  parseUploadNotification,
} from './notificationParser'

const sampleNotification = `[vcs]2026-05-22 11:21:57
uploadLog, fileName: PDA_MTM-Z2_D00001_Patch Pump PDA_version2.3.0_.zip, urlPath: https://d3ci4jgewizada.cloudfront.net/vcs/eu/errorlog/cgms/PDA_MTM-Z2_D00001_Patch+Pump+PDA_version2.3.0_.zip`

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
})

describe('buildPassword', () => {
  it('builds a PDA password when the serial number is known', () => {
    expect(buildPassword('D00001')).toBe('PDA_D00001')
  })

  it('returns an empty password when the serial number is not known', () => {
    expect(buildPassword()).toBe('')
  })
})
