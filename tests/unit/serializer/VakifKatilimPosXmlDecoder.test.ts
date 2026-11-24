import { describe, expect, it } from 'vitest'
import { PosHttpError } from '../../../src/errors.js'
import { VakifKatilimPosXmlDecoder } from '../../../src/serializer/VakifKatilimPosXmlDecoder.js'

describe('VakifKatilimPosXmlDecoder', () => {
  it('decodes standard_utf8_response', () => {
    const input = `<?xml version="1.0" encoding="UTF-8"?>
<VPosTransactionResponseContract xmlns:xsd="http://www.w3.org/2001/XMLSchema"
xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
 <VPosMessageContract>
<OkUrl>http://localhost/ThreeDModel/Approval</OkUrl>
<FailUrl>http://localhost/ThreeDModel/Fail</FailUrl>
<HashData>DvAUXMvYV4ex5m16mMezEl+kxrI=</HashData>
<MerchantId>1</MerchantId>
<SubMerchantId>0</SubMerchantId>
<CustomerId>936</CustomerId>
<UserName>APIUSER</UserName>
<HashPassword>kfkdsnskslkclswr9430ır</HashPassword>
<MerchantOrderId>1554891870</MerchantOrderId>
<InstallmentCount>0</InstallmentCount>
<Amount>111</Amount>
<FECAmount>0</FECAmount>
<AdditionalData>
 <AdditionalDataList>
 	<VPosAdditionalData>
 <Key>MD</Key>
 <Data>vygnTBD4smBxAOlDsgbaOQ==</Data>
 </VPosAdditionalData>
 </AdditionalDataList>
</AdditionalData>
<Products/>
<Addresses/>
<PaymentType>1</PaymentType>
<DebtId>0</DebtId>
<SurchargeAmount>0</SurchargeAmount>
<SGKDebtAmount>0</SGKDebtAmount>
<InstallmentMaturityCommisionFlag>0</InstallmentMaturityCommisionFlag>
<TransactionSecurity>3</TransactionSecurity>
 </VPosMessageContract>
 <IsEnrolled>true</IsEnrolled>
 <IsVirtual>false</IsVirtual>
 <RRN>922709016599</RRN>
 <Stan>016599</Stan>
 <ResponseCode>00</ResponseCode>
 <ResponseMessage>Provizyon Alindi.</ResponseMessage>
 <OrderId>15161</OrderId>
 <TransactionTime>00010101T00:00:00</TransactionTime>
 <MerchantOrderId>1554891870</MerchantOrderId>
 <HashData>bcCqBe4hbElPOVYtfvsw7M44usQ=</HashData>
</VPosTransactionResponseContract>`

    expect(VakifKatilimPosXmlDecoder.decode(input)).toStrictEqual({
      VPosMessageContract: {
        OkUrl: 'http://localhost/ThreeDModel/Approval',
        FailUrl: 'http://localhost/ThreeDModel/Fail',
        HashData: 'DvAUXMvYV4ex5m16mMezEl+kxrI=',
        MerchantId: '1',
        SubMerchantId: '0',
        CustomerId: '936',
        UserName: 'APIUSER',
        HashPassword: 'kfkdsnskslkclswr9430ır',
        MerchantOrderId: '1554891870',
        InstallmentCount: '0',
        Amount: '111',
        FECAmount: '0',
        AdditionalData: {
          AdditionalDataList: { VPosAdditionalData: { Key: 'MD', Data: 'vygnTBD4smBxAOlDsgbaOQ==' } },
        },
        Products: '',
        Addresses: '',
        PaymentType: '1',
        DebtId: '0',
        SurchargeAmount: '0',
        SGKDebtAmount: '0',
        InstallmentMaturityCommisionFlag: '0',
        TransactionSecurity: '3',
      },
      IsEnrolled: 'true',
      IsVirtual: 'false',
      RRN: '922709016599',
      Stan: '016599',
      ResponseCode: '00',
      ResponseMessage: 'Provizyon Alindi.',
      OrderId: '15161',
      TransactionTime: '00010101T00:00:00',
      MerchantOrderId: '1554891870',
      HashData: 'bcCqBe4hbElPOVYtfvsw7M44usQ=',
      '@xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
      '@xmlns:xsd': 'http://www.w3.org/2001/XMLSchema',
    })
  })

  it('decodes response_with_utf16_encoding_declaration', () => {
    const input = `<?xml version="1.0" encoding="utf-16"?>
<VPosTransactionResponseContract xmlns:xsd="http://www.w3.org/2001/XMLSchema"
xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
 <VPosOrderData>
 <OrderContract>
 <OrderId>12743</OrderId>
 <MerchantOrderId>1995434716</MerchantOrderId>
 <ResponseCode>00</ResponseCode>
 <ResponseMessage/>
 </OrderContract>
 </VPosOrderData>
 <ResponseCode>00</ResponseCode>
 <ResponseMessage/>
</VPosTransactionResponseContract>`

    expect(VakifKatilimPosXmlDecoder.decode(input)).toStrictEqual({
      VPosOrderData: {
        OrderContract: { OrderId: '12743', MerchantOrderId: '1995434716', ResponseCode: '00', ResponseMessage: '' },
      },
      ResponseCode: '00',
      ResponseMessage: '',
      '@xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
      '@xmlns:xsd': 'http://www.w3.org/2001/XMLSchema',
    })
  })

  it('decodes response_with_null_character', () => {
    const input =
      '<?xml version="1.0" encoding="UTF-8"?><VPosTransactionResponseContract><ResponseCode>&#x0;00</ResponseCode></VPosTransactionResponseContract>'

    expect(VakifKatilimPosXmlDecoder.decode(input)).toStrictEqual({ ResponseCode: '00' })
  })

  // addition: V5, a nil element reads like an empty one wherever the record comes from
  it('reads an element that only carries an attribute with an empty text', () => {
    const xml =
      '<R xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><A xsi:nil="true"/><B><C xsi:nil="true"/></B><D/></R>'

    expect(VakifKatilimPosXmlDecoder.decode(xml)).toStrictEqual({
      '@xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
      A: { '@xsi:nil': 'true', '#': '' },
      B: { C: { '@xsi:nil': 'true', '#': '' } },
      D: '',
    })
  })

  // addition: V5, a repeated element is a list and an attributed one a record: neither reads as the text "00"
  it('keeps repeated and attributed elements apart from plain text', () => {
    const repeated = VakifKatilimPosXmlDecoder.decode(
      '<R><ResponseCode>00</ResponseCode><ResponseCode>00</ResponseCode></R>',
    )
    expect(repeated.ResponseCode).toStrictEqual(['00', '00'])

    const attributed = VakifKatilimPosXmlDecoder.decode('<R><ResponseCode a="b">00</ResponseCode></R>')
    expect(attributed.ResponseCode).toStrictEqual({ '@a': 'b', '#': '00' })

    const nested = VakifKatilimPosXmlDecoder.decode('<R><ResponseCode><X>00</X></ResponseCode></R>')
    expect(nested.ResponseCode).toStrictEqual({ X: '00' })
  })

  // addition: V5, text is not trimmed away from the exact bytes the bank sent beyond the XML rules
  it('keeps the characters of a padded code for the mapper to judge', () => {
    expect(VakifKatilimPosXmlDecoder.decode('<R><ResponseCode>00 </ResponseCode></R>').ResponseCode).toBe('00')
    expect(VakifKatilimPosXmlDecoder.decode('<R><ResponseCode><![CDATA[ 00]]></ResponseCode></R>').ResponseCode).toBe(
      ' 00',
    )
  })

  // addition: a bank answer never defines entities or a document type: expansion is refused before parsing
  it.each([
    ['an internal entity', '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x "AAAA">]><r><a>&x;</a></r>'],
    [
      'an external entity',
      '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]><r><a>&x;</a></r>',
    ],
    [
      'a nested entity bomb',
      '<!DOCTYPE r [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;">]><r><a>&b;</a></r>',
    ],
    ['a lower case declaration', '<!doctype r [<!entity x "A">]><r><a>&x;</a></r>'],
    ['an entity after the declaration', '<?xml version="1.0"?><r><!ENTITY x "A"><a>1</a></r>'],
  ])('refuses %s', (_n, xml) => {
    expect(() => VakifKatilimPosXmlDecoder.decode(xml)).toThrow(PosHttpError)
  })

  // addition: HTML, empty and non-XML answers are HTTP-level failures
  it.each([
    ['an HTML page', '<!DOCTYPE html><html><body>Request blocked</body></html>'],
    ['a bare html root', '<html><body>x</body></html>'],
    ['an empty body', ''],
    ['white space', ' \n '],
    ['plain text', 'Service Unavailable'],
    ['a truncated document', '<r><a>1</a>'],
  ])('refuses %s', (_n, xml) => {
    expect(() => VakifKatilimPosXmlDecoder.decode(xml)).toThrow(PosHttpError)
  })

  // addition: the refusal looks at the text the parser reads, so a declaration split by a null character is seen
  it.each([
    ['DOCTYPE', '<?xml version="1.0"?><!DOC&#x0;TYPE a [<!ENT&#x0;ITY x "BOOM">]><R><A>&x;</A></R>'],
    ['lower case', '<?xml version="1.0"?><!doc&#x0;type a [<!ent&#x0;ity x "BOOM">]><R><A>&x;</A></R>'],
    ['several characters', '<!D&#x0;O&#x0;C&#x0;TYPE a [<!E&#x0;N&#x0;T&#x0;ITY x "BOOM">]><R><A>&x;</A></R>'],
    ['only the entity', '<!DOCTYPE a [<!ENT&#x0;ITY x "BOOM">]><R><A>&x;</A></R>'],
    ['before the declaration', '&#x0;<!DOC&#x0;TYPE a [<!ENTITY x "BOOM">]><R><A>&x;</A></R>'],
  ])('refuses a split %s', (_n, xml) => {
    expect(() => VakifKatilimPosXmlDecoder.decode(xml)).toThrow(PosHttpError)
  })

  // addition: the utf-16 declaration is removed in any letter case, like the client reads it
  it.each(['utf-16', 'UTF-16', 'Utf-16'])('removes a %s declaration', (declared) => {
    expect(
      VakifKatilimPosXmlDecoder.decode(`<?xml version="1.0" encoding="${declared}"?><R><A>1</A></R>`),
    ).toStrictEqual({
      A: '1',
    })
  })
})
