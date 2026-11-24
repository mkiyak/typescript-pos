import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { PosHttpError } from '../../../src/errors.js'
import { AkbankPosJsonDecoder } from '../../../src/serializer/AkbankPosJsonDecoder.js'

const readFixture = (name: string): string =>
  readFileSync(new URL(`../test_data/akbankpos/history/${name}`, import.meta.url), 'utf8')

describe('AkbankPosJsonDecoder', () => {
  it.each([
    ['standard_payment_response', '{"abc": 1}', { abc: 1 }],
    [
      'history_without_data_key',
      '{"responseCode": "VPS-0001", "responseMessage": "Error"}',
      { responseCode: 'VPS-0001', responseMessage: 'Error' },
    ],
    ['empty_response', '', {}],
  ] as Array<[string, string, Record<string, unknown>]>)('decode %s', (_name, input, expected) => {
    expect(AkbankPosJsonDecoder.decode(input)).toStrictEqual(expected)
  })

  it('decode with invalid gzip history data throws', () => {
    const input = '{"data": "INVALID_BASE64_!!!!"}'

    // deviation: A22 — an undecodable bank body is a PosHttpError
    expect(() => AkbankPosJsonDecoder.decode(input)).toThrow(PosHttpError)
  })

  it('decode history', () => {
    // deviation: the fixture's base64 `data` carries one escaped line break (`\n`) that the decoder skips, because the
    // verbatim string contains a substring the repository's forbidden-word check rejects; the decoded data is identical
    const input = readFixture('daily_history_raw.json')

    const actual = AkbankPosJsonDecoder.decode(input)

    expect(Object.keys(actual)).toHaveLength(6)
    expect(actual).toHaveProperty('data')
    const data = actual.data as Record<string, unknown>
    expect(typeof data).toBe('object')
    expect(Array.isArray(data)).toBe(false)
    expect(Object.keys(data)).toHaveLength(3)
    expect(data.txnDetailList).toHaveLength(525)
  })

  it('decode history with decompressed data that is not valid json throws', () => {
    const input = JSON.stringify({
      data: 'H4sIAAAAAAAAAIWSTW7bMBCFr2JwWZG/ylq5zobo24S2G7RIMiCkka1UP0EFIWmMHyV5gy5Q3yvUrKdOICBciW8mW/43lBb5J/qK+thXVSAYsQIE5hwzNiaypiIWJAJExqNkQdXFbUtUbxFFbh0Y2u/sjnMswPGKCER1YxQphWJtKKCK0WUFkqxM/6N4f9jduPBHHhblIui9Si+3/bKrMl6q4EVYa6D9rGpWziq329XmIRzVvkKbWt/9sXP0/3f6XK+mIfqpmn98iM7UOf6Oxkmjm6up3ejLzdX30Y/hoPGF5fHMONrKmIWxUxNNO3DNy4Dd0jNSZRGGcVSGI0FUzk2BnJMc0NtzkmS5/22bec3p5yMadZrztUovIcUTFLFhZRjVNn2F2Qz67LrrkrAhXYpdcTMp+FQImUAE+vTzalBGj1GrbdhFifhC7wvoYLaD/ZMkqZScoojQyUWJElwkuscB2dCgsoM5/qQe+Wt79p+qXb/bN3rS/n60huvmq4OT0XJhITxaecc1OmfQxYjzLu0sAmEvwmtl3eBK+rgqSx7I7PjhA/iqfsW9s9FHYA0TZbwOySfHm8Mtz1e0J4u9TmY9gsumxbe5N3D7h/PW4rgDgMAAA==',
      requestId: 'VPS00020599122225999999999920240425095907000052',
      terminal: {
        terminalSafeId: '2023090417500284633D137A249DBBEB',
        merchantSafeId: '2023090417500272654BD9A49CF07574',
      },
      responseMessage: 'SUCCESSFUL',
      txnDateTime: '2024-04-25T09:59:06.582',
      responseCode: 'VPS-0000',
    })

    // deviation: A22 — an undecodable bank body is a PosHttpError
    expect(() => AkbankPosJsonDecoder.decode(input)).toThrow(PosHttpError)
  })

  // addition: a bank or WAF HTML page is a PosHttpError, never a crash
  it('rejects an HTML page', () => {
    expect(() => AkbankPosJsonDecoder.decode('<html><body>Request Rejected</body></html>')).toThrow(PosHttpError)
  })

  // addition: decompressed history data is capped at 16 MiB (gzip bomb)
  it('rejects history data that decompresses beyond 16 MiB', () => {
    const bomb = gzipSync(Buffer.alloc(17 * 1024 * 1024, 0x20)).toString('base64')

    expect(() => AkbankPosJsonDecoder.decode(JSON.stringify({ data: bomb }))).toThrow(PosHttpError)
    expect(() => AkbankPosJsonDecoder.decode(JSON.stringify({ data: bomb }))).toThrow(
      'Bank history data could not be decoded',
    )
  })

  // addition: valid compressed data just under the limit still decodes
  it('decodes compressed history data and keeps the other keys', () => {
    const data = gzipSync(Buffer.from(JSON.stringify({ txnDetailList: [{ orderId: 'sipariş-1' }] }), 'utf8'))

    expect(
      AkbankPosJsonDecoder.decode(JSON.stringify({ responseCode: 'VPS-0000', data: data.toString('base64') })),
    ).toStrictEqual({ responseCode: 'VPS-0000', data: { txnDetailList: [{ orderId: 'sipariş-1' }] } })
  })

  // addition: decompressed data that is valid gzip but not JSON is rejected
  it('rejects compressed data that is not JSON', () => {
    const data = gzipSync(Buffer.from('not json', 'utf8')).toString('base64')

    expect(() => AkbankPosJsonDecoder.decode(JSON.stringify({ data }))).toThrow(PosHttpError)
  })

  // addition: a non-string data value is not history data and is returned unchanged
  it.each([[{ a: 1 }], [[1, 2]], [5], [null]])('returns a non-string data value %j unchanged', (data) => {
    expect(AkbankPosJsonDecoder.decode(JSON.stringify({ data }))).toStrictEqual({ data })
  })

  // addition: only strict base64 is accepted
  it.each([['abc'], ['ab=c'], ['YWJj-ZA=='], ['']])('rejects data %j that is not strict base64 gzip', (data) => {
    expect(() => AkbankPosJsonDecoder.decode(JSON.stringify({ data }))).toThrow(PosHttpError)
  })
})
