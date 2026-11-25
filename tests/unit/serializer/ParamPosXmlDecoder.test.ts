import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PosHttpError } from '../../../src/errors.js'
import { ParamPosXmlDecoder } from '../../../src/serializer/ParamPosXmlDecoder.js'

const fixture = (name: string): string =>
  readFileSync(new URL(`../test_data/parampos/${name}`, import.meta.url), 'utf8')

const wrap = (body: string): string =>
  `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${body}</soap:Body></soap:Envelope>`

describe('ParamPosXmlDecoder', () => {
  it('decodes 3d_form_success', () => {
    const result = ParamPosXmlDecoder.decode(fixture('3d_form_response_success.xml')) as {
      TP_WMD_UCDResponse: { TP_WMD_UCDResult: Record<string, unknown> }
    }
    const inner = result.TP_WMD_UCDResponse.TP_WMD_UCDResult
    expect(typeof inner.UCD_HTML).toBe('string')
    expect(String(inner.UCD_HTML).startsWith('<!DOCTYPE html SYSTEM "about:legacy-compat">')).toBe(true)
    // The large document is replaced like the expected value of the source case.
    inner.UCD_HTML = 'html-document'

    expect(result).toStrictEqual({
      TP_WMD_UCDResponse: {
        TP_WMD_UCDResult: {
          Islem_ID: '6021840768',
          Islem_GUID: 'd68ac15c-17ca-4b7d-a046-10700291b249',
          UCD_HTML: 'html-document',
          UCD_MD:
            'MosNOirpqxod2A0BdoPpFNf7E/hJX2pKvt8hunrQF2RSrggeWpNj9p+XDEgRdWfGdtGMHF5A7X/uVbJTb3cCN5LGcG2JsGd69bXc7yYBGGw/VMFTcHDObj+cVR6fP2k1s531ozcBEFN1hv+fwBH80YGHP2a6xbRujYzME2iPuPgCdr7wkoSWcZvwB5M73bFow3Jx3vqkwceaPUO6dat7m5Uv1dKmbp+py3yOR0nVaFGnKTmIB4JIAIuP24hCU2MJi+hvKDf7+IJIEl5cjotiUx/J0AINoeuIGrklDAZ8JRA7pxYXpZLwc3ZX60VpWvfS7sSOdayadMBOvltQSdRrPPhJztVNmkztgUe7s3rbpdVr4Fc/KzGtPa5PZLnpkXszhOO4g+pw0A3KuFsqTdFuuu25CqBTX/aG4yZ4VO7UKfG27cTgRaObKsU+YiwOhH/VgGODvd5qrR02gOY8f9Xqtw==',
          Sonuc: '1',
          Sonuc_Str: 'İşlem Başarılı',
          Banka_Sonuc_Kod: '0',
          Siparis_ID: '20241229D2FF',
        },
      },
    })
  })

  it('decodes 3d_host_form_success without the header that echoes the password', () => {
    const xml = fixture('3d_host_form_response_success.xml')
    expect(xml).toContain('CLIENT_PASSWORD')
    const result = ParamPosXmlDecoder.decode(xml)

    expect(Object.keys(result)).toStrictEqual(['TO_Pre_Encrypting_OOSResponse'])
    expect(result).toStrictEqual({
      TO_Pre_Encrypting_OOSResponse: {
        TO_Pre_Encrypting_OOSResult:
          'ImBuIu4mlRqIABImnjl/ikGHMe5ZOjZjP3wx61Wa7FxC3XrjnDTCsn7PngJ8DPdEV840PmqT+jVgsm+KaWcIZQq/lcJQKD3TdM99+MUcOKLxxFyByUJP3DkY9zZ4/2TJ7Px2HzZdfccockhMooHuM+A8PxjHKdK8z4pOvW/tpo/U4i6/jJPT9ZnhHL4GdRNOtu9l6sGtPHeKYC/FHYAZpGNXjR9+RCZGP/xTeFgC+Gl1o7dpRZaibII6PdPK1CNMdF8O1d1QI+PDCq/TxDSQxyyJgqovzYfBHT5mWjOx+WhiajrswNzVirR9hpii+Hq3sk+LnH90Psobh5db3F4BPpgUIuS6moVERKgq5HIhLkR4fe5TMfxcvOhj3Pg0RBQR',
      },
    })
    expect(JSON.stringify(result)).not.toContain('CLIENT_PASSWORD')
  })

  // addition: one row of a dataset is a record, two rows are an array; prefixes and attributes are kept
  it('reads one and two <Temp> rows of a diffgram', () => {
    const one = ParamPosXmlDecoder.decode(
      wrap(
        '<R><RResult><diffgr:diffgram xmlns:diffgr="urn:schemas-microsoft-com:xml-diffgram-v1"><DocumentElement><Temp diffgr:id="Temp1"><Sonuc>1</Sonuc></Temp></DocumentElement></diffgr:diffgram></RResult></R>',
      ),
    ) as never as { R: { RResult: Record<string, Record<string, Record<string, unknown>>> } }
    const temp = one.R.RResult['diffgr:diffgram']?.DocumentElement?.Temp
    expect(temp).toStrictEqual({ '@diffgr:id': 'Temp1', Sonuc: '1' })

    const two = ParamPosXmlDecoder.decode(
      wrap(
        '<R><RResult><diffgr:diffgram xmlns:diffgr="urn:schemas-microsoft-com:xml-diffgram-v1"><DocumentElement><Temp diffgr:id="Temp1"><Sonuc>1</Sonuc></Temp><Temp diffgr:id="Temp2"><Sonuc>2</Sonuc></Temp></DocumentElement></diffgr:diffgram></RResult></R>',
      ),
    ) as never as { R: { RResult: Record<string, Record<string, Record<string, unknown>>> } }
    expect(two.R.RResult['diffgr:diffgram']?.DocumentElement?.Temp).toStrictEqual([
      { '@diffgr:id': 'Temp1', Sonuc: '1' },
      { '@diffgr:id': 'Temp2', Sonuc: '2' },
    ])
  })

  // addition: a document type or an entity definition is refused (the bank never sends one)
  it('refuses an answer that defines an entity', () => {
    const xml = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e "boom">]><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><r>&e;</r></soap:Body></soap:Envelope>`
    expect(() => ParamPosXmlDecoder.decode(xml)).toThrow(PosHttpError)
  })

  it.each([
    ['an HTML page', '<html><body>blocked</body></html>'],
    ['an empty answer', ''],
    ['no body', '<a/>'],
  ])('rejects %s', (_name, xml) => {
    expect(() => ParamPosXmlDecoder.decode(xml)).toThrow(PosHttpError)
  })
})
