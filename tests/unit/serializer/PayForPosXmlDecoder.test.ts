import { describe, expect, it } from 'vitest'
import { PosHttpError } from '../../../src/errors.js'
import { PayForPosXmlDecoder } from '../../../src/serializer/PayForPosXmlDecoder.js'

describe('PayForPosXmlDecoder', () => {
  it.each([
    [
      'standard_response',
      `<?xml version="1.0" encoding="utf-8"?>
<PayforResponse>
<AuthCode>S31432</AuthCode>
<HostRefNum>326011208369</HostRefNum>
<ProcReturnCode>00</ProcReturnCode>
<TransId>20230917EF0E</TransId>
<ErrMsg>Onaylandı</ErrMsg>
<CardHolderName>John Doe</CardHolderName>
<ArtiTaksit>0</ArtiTaksit>
<BankInternalResponseMessage></BankInternalResponseMessage>
<PAYFORFROMXMLREQUEST>1</PAYFORFROMXMLREQUEST>
<SESSION_SYSTEM_USER>0</SESSION_SYSTEM_USER>
</PayforResponse>`,
      {
        AuthCode: 'S31432',
        HostRefNum: '326011208369',
        ProcReturnCode: '00',
        TransId: '20230917EF0E',
        ErrMsg: 'Onaylandı',
        CardHolderName: 'John Doe',
        ArtiTaksit: '0',
        BankInternalResponseMessage: '',
        PAYFORFROMXMLREQUEST: '1',
        SESSION_SYSTEM_USER: '0',
      },
    ],
    [
      'response_with_redundant_crlf_whitespace',
      '<?xml version="1.0" encoding="utf-8"?>\r\n<PayforResponse>\r\n  <AuthCode>S31432</AuthCode>\r\n</PayforResponse>',
      { AuthCode: 'S31432' },
    ],
    [
      'response_with_whitespace_in_empty_elements',
      '<?xml version="1.0" encoding="utf-8"?>\r\n<PayforResponse>\r\n<MbrId>5</MbrId>\r\n<MD>\r\n</MD>\r\n</PayforResponse>',
      { MbrId: '5', MD: '' },
    ],
    ['cancel_response', '<PayforResponse><Status>OK</Status></PayforResponse>', { Status: 'OK' }],
  ] as Array<[string, string, Record<string, unknown>]>)('decode %s', (_name, input, expected) => {
    expect(PayForPosXmlDecoder.decode(input)).toStrictEqual(expected)
  })

  // addition: a bank/WAF HTML page and an empty body are PosHttpError, never a half-parsed record
  it.each([
    ['an HTML page', '<html><body>Request Rejected</body></html>'],
    ['an empty body', ''],
  ])('rejects %s', (_name, input) => {
    expect(() => PayForPosXmlDecoder.decode(input)).toThrow(PosHttpError)
  })

  // addition: a CRLF followed by indentation inside a text value is removed (documented behaviour of the cleanup)
  it('removes a CRLF run inside text', () => {
    expect(
      PayForPosXmlDecoder.decode('<PayforResponse><ErrMsg>first\r\n  second</ErrMsg></PayforResponse>'),
    ).toStrictEqual({
      ErrMsg: 'firstsecond',
    })
  })
})
