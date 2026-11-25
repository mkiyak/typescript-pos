import { beforeEach, describe, expect, it } from 'vitest'
import { ParamPosResponseDataMapper } from '../../../../../src/data-mapper/response/mapper/ParamPosResponseDataMapper.js'
import { ParamPosResponseValueFormatter } from '../../../../../src/data-mapper/response/value-formatter/ParamPosResponseValueFormatter.js'
import { ParamPosResponseValueMapper } from '../../../../../src/data-mapper/response/value-mapper/ParamPosResponseValueMapper.js'
import { NotImplementedError } from '../../../../../src/errors.js'
import type { PosLogger } from '../../../../../src/logger.js'
import { CURRENCY, TX_TYPE } from '../../../../../src/PosInterface.js'
import type { PosOrder } from '../../../../../src/types.js'
import {
  cancelCases,
  type Data,
  NOW,
  paymentCases,
  provisionSuccess,
  refundCases,
  statusCases,
  threeDCases,
  threeDHostCases,
  threeDPayCases,
} from './ParamPosResponseDataMapper.data.js'

/** `assertArrayHasKey` + `assertIsArray` + `assertNotEmpty`, then `unset`. */
function takeNonEmpty(actual: Data, key: string): void {
  expect(actual).toHaveProperty(key)
  const value = actual[key]
  expect(value !== null && typeof value === 'object').toBe(true)
  expect(Object.keys(value as Data).length).toBeGreaterThan(0)
  delete actual[key]
}

/** `ksort` both sides, then compare values and types. */
function sorted(data: Data): Data {
  return Object.fromEntries(Object.entries(data).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

/** The Türkiye calendar day of an instant as `YYYYMMDD`. */
function turkeyDay(date: Date): string {
  return new Date(date.getTime() + 3 * 3_600_000).toISOString().slice(0, 10).replace(/-/g, '')
}

const ORDER = { id: '2025010408A0', currency: CURRENCY.TRY, amount: 1.01 } as PosOrder

/** A record whose result code is only inherited, never its own. */
function inheritedOnly(members: Data): Data {
  return Object.create(members) as Data
}

describe('ParamPosResponseDataMapper', () => {
  let mapper: ParamPosResponseDataMapper
  let logged: unknown[][]
  let warnings: unknown[][]

  beforeEach(() => {
    logged = []
    warnings = []
    const recorder = (...args: unknown[]) => {
      logged.push(args)
    }
    const logger: PosLogger = {
      debug: recorder,
      info: recorder,
      warn: (...args: unknown[]) => {
        warnings.push(args)
      },
      error: recorder,
    }
    mapper = new ParamPosResponseDataMapper(
      new ParamPosResponseValueFormatter(),
      new ParamPosResponseValueMapper(),
      logger,
    )
  })

  it('supports', () => {
    expect(ParamPosResponseDataMapper.supports('ParamPos')).toBe(true)
    expect(ParamPosResponseDataMapper.supports('Param3DHostPos')).toBe(true)
    expect(ParamPosResponseDataMapper.supports('AkbankPos')).toBe(false)
  })

  it.each([
    [null, false],
    ['', false],
    ['2', false],
    ['3', false],
    ['4', false],
    ['7', false],
    ['1', true],
    ['0', false],
  ])('is3dAuthSuccess(%j) -> %j', (mdStatus, expected) => {
    expect(mapper.is3dAuthSuccess(mdStatus)).toBe(expected)
  })

  it.each([
    [{}, null],
    [{ mdStatus: '1' }, '1'],
  ])('extractMdStatus(%j) -> %j', (responseData, expected) => {
    expect(mapper.extractMdStatus(responseData)).toBe(expected)
  })

  // addition: the 3D result is the own text exactly as sent
  it.each([
    [{ mdStatus: ' 1' }, ' 1'],
    [{ mdStatus: 1 }, null],
    [{ mdStatus: ['1'] }, null],
    [{ mdStatus: '' }, null],
    [inheritedOnly({ mdStatus: '1' }), null],
  ])('extractMdStatus(%j) reads only an own text', (responseData, expected) => {
    expect(mapper.extractMdStatus(responseData)).toBe(expected)
    expect(mapper.is3dAuthSuccess(mapper.extractMdStatus(responseData))).toBe(false)
  })

  describe('parseCode', () => {
    // addition
    it.each([
      ['1', 1],
      [1, 1],
      ['-221', -221],
      ['-1', -1],
      ['0', 0],
      [-0, 0],
      ['007', 7],
      ['999999999', 999999999],
    ])('accepts %j', (value, expected) => {
      expect(ParamPosResponseDataMapper.parseCode(value)).toBe(expected)
    })

    it.each([
      '1.0',
      ' 1',
      '1 ',
      '1e3',
      '+1',
      '',
      '-',
      '9999999999',
      true,
      false,
      {},
      ['1'],
      null,
      undefined,
      1.5,
      Number.NaN,
      1e21,
      10_000_000_000,
      Symbol('x'),
    ])('rejects %j', (value) => {
      expect(ParamPosResponseDataMapper.parseCode(value)).toBeNull()
    })
  })

  describe('mapPaymentResponse', () => {
    it.each(Object.entries(paymentCases))('%s', (_name, { order, txType, responseData, expectedData }) => {
      const actual: Data = mapper.mapPaymentResponse(responseData, txType as never, order as PosOrder)

      if (expectedData.transaction_time === NOW) {
        expect(turkeyDay(actual.transaction_time)).toBe(turkeyDay(new Date()))
      } else {
        expect(actual.transaction_time).toBeNull()
      }
      delete actual.transaction_time
      const expected = { ...expectedData }
      delete expected.transaction_time

      takeNonEmpty(actual, 'all')
      expect(sorted(actual)).toStrictEqual(sorted(expected))
    })

    // addition: an answer that cannot be read is a plain decline, never an error
    it.each([{}, null, [], 'text', { TP_WMD_UCDResponse: null }, { TP_WMD_UCDResponse: [] }])(
      'unreadable answer %j is declined',
      (answer) => {
        const actual = mapper.mapPaymentResponse(answer as never, TX_TYPE.PAY_AUTH, ORDER)

        expect(actual.status).toBe('declined')
        expect(actual.order_id).toBeNull()
        expect(actual.proc_return_code).toBeNull()
        expect(actual.error_code).toBeNull()
        expect(actual.transaction_time).toBeNull()
      },
    )

    it.each([TX_TYPE.PAY_PRE_AUTH, TX_TYPE.PAY_POST_AUTH])('empty answer of %s is declined', (txType) => {
      expect(mapper.mapPaymentResponse({}, txType, ORDER).status).toBe('declined')
    })

    it('an order that is not a record maps without error', () => {
      const actual = mapper.mapPaymentResponse({}, TX_TYPE.PAY_AUTH, null as never)

      expect(actual.status).toBe('declined')
    })

    describe('strict approval', () => {
      const sale = (result: Data): Data => ({ TP_WMD_UCDResponse: { TP_WMD_UCDResult: result } })
      const approvedResult = { Sonuc: '1', Islem_ID: '3007296556', Siparis_ID: 'x1', Bank_Trans_ID: 't1' }

      // addition: the control row that the rows below differ from
      it('approves a plain success answer', () => {
        expect(mapper.mapPaymentResponse(sale(approvedResult), TX_TYPE.PAY_AUTH, ORDER).status).toBe('approved')
      })

      // addition: a success code that is padded, fractional, a list, a boolean or only inherited is no success
      it.each([
        ['padded code', { ...approvedResult, Sonuc: ' 1' }],
        ['padded after', { ...approvedResult, Sonuc: '1 ' }],
        ['fractional code', { ...approvedResult, Sonuc: '1.0' }],
        ['exponent code', { ...approvedResult, Sonuc: '1e0' }],
        ['list code', { ...approvedResult, Sonuc: ['1'] }],
        ['boolean code', { ...approvedResult, Sonuc: true }],
        ['too long code', { ...approvedResult, Sonuc: '9999999999' }],
      ])('%s is declined', (_name, result) => {
        const actual = mapper.mapPaymentResponse(sale(result), TX_TYPE.PAY_AUTH, ORDER)

        expect(actual.status).toBe('declined')
        expect(actual.order_id).toBeNull()
        expect(actual.transaction_id).toBeNull()
      })

      // addition: the result record itself must be an own record, not inherited
      it('an inherited result record is declined', () => {
        const answer = inheritedOnly({ TP_WMD_UCDResponse: { TP_WMD_UCDResult: approvedResult } })

        expect(mapper.mapPaymentResponse(answer, TX_TYPE.PAY_AUTH, ORDER).status).toBe('declined')
      })

      it('an inherited result code is declined', () => {
        const result = inheritedOnly({ Sonuc: '1', Islem_ID: '3007296556' })

        expect(mapper.mapPaymentResponse(sale(result), TX_TYPE.PAY_AUTH, ORDER).status).toBe('declined')
      })

      // addition: a sale needs its transaction number; a success code without one is the gateway's unknown outcome
      it.each([
        ['zero', '0'],
        ['missing', undefined],
        ['padded', ' 3007296556'],
        ['negative', '-5'],
        ['list', ['3007296556']],
        ['signed', '+5'],
        ['empty', ''],
      ])('a sale without a usable Islem_ID (%s) is declined', (_name, id) => {
        const result: Data = { ...approvedResult }
        if (id === undefined) delete result.Islem_ID
        else result.Islem_ID = id

        const actual = mapper.mapPaymentResponse(sale(result), TX_TYPE.PAY_AUTH, ORDER)

        expect(actual.status).toBe('declined')
        expect(actual.proc_return_code).toBe('1')
        expect(actual.order_id).toBeNull()
        expect(actual.error_message).toBe('success code without receipt')
      })

      // addition: closing a pre-authorization answers without a transaction number
      it('post-auth is approved by its code alone', () => {
        const answer = {
          TP_Islem_Odeme_OnProv_KapaResponse: { TP_Islem_Odeme_OnProv_KapaResult: { Sonuc: '1', Siparis_ID: 'p1' } },
        }

        expect(mapper.mapPaymentResponse(answer, TX_TYPE.PAY_POST_AUTH, ORDER).status).toBe('approved')
      })

      // addition: non-scalar bank values never become "[object Object]" in text fields
      it('record and list values in text fields read as null', () => {
        const result = {
          ...approvedResult,
          Siparis_ID: { a: 1 },
          Bank_Trans_ID: ['t'],
          Bank_AuthCode: {},
          Bank_HostRefNum: [['r']],
        }

        const actual = mapper.mapPaymentResponse(sale(result), TX_TYPE.PAY_AUTH, ORDER)

        expect(actual.status).toBe('approved')
        expect(actual.order_id).toBeNull()
        expect(actual.transaction_id).toBeNull()
        expect(actual.auth_code).toBeNull()
        expect(actual.ref_ret_num).toBeNull()
      })

      // addition: the amount and the currency of a payment are the order's, never what the bank echoed
      it('amount and currency come from the order', () => {
        const result = { ...approvedResult, Toplam_Tutar: '999.99', Doviz_Kodu: 'EUR' }

        const actual = mapper.mapPaymentResponse(sale(result), TX_TYPE.PAY_AUTH, ORDER)

        expect(actual.amount).toBe(1.01)
        expect(actual.currency).toBe('TRY')
      })

      it('a declined answer reads its message from the first usable text', () => {
        const actual = mapper.mapPaymentResponse(
          sale({ Sonuc: '-5', Sonuc_Str: '  ', Bank_HostMsg: ' Declined ' }),
          TX_TYPE.PAY_AUTH,
          ORDER,
        )

        expect(actual.error_message).toBe('Declined')
        expect(actual.error_code).toBe('-5')
      })

      // addition: a code the bank prints as a number is read like its text
      it('a numeric code approves like its text', () => {
        const actual = mapper.mapPaymentResponse(sale({ ...approvedResult, Sonuc: 1 }), TX_TYPE.PAY_AUTH, ORDER)

        expect(actual.status).toBe('approved')
        expect(actual.proc_return_code).toBe('1')
      })
    })
  })

  describe('map3DPaymentData', () => {
    it.each(Object.entries(threeDCases))(
      '%s',
      (_name, { order, txType, threeDResponseData, paymentData, expectedData }) => {
        const actual: Data = mapper.map3DPaymentData(
          threeDResponseData,
          paymentData,
          txType as never,
          order as PosOrder,
        )

        delete actual.transaction_time
        const expected = { ...expectedData }
        delete expected.transaction_time

        expect(actual).toHaveProperty('all')
        if (Object.keys(paymentData).length > 0) {
          takeNonEmpty(actual, 'all')
        }
        delete actual.all
        expect(actual).toHaveProperty('3d_all')
        expect(typeof actual['3d_all']).toBe('object')
        if (Object.keys(threeDResponseData).length > 0) {
          takeNonEmpty(actual, '3d_all')
        }
        delete actual['3d_all']

        expect(sorted(actual)).toStrictEqual(sorted(expected))
      },
    )

    // addition: without a provision the callback alone is a decline carrying the browser's values
    it('maps a callback without a provision answer as declined', () => {
      const actual = mapper.map3DPaymentData(
        threeDCases.success1?.threeDResponseData as Data,
        null,
        TX_TYPE.PAY_AUTH,
        ORDER,
      )

      expect(actual.status).toBe('declined')
      expect(actual.payment_model).toBe('3d')
      expect(actual.md_status).toBe('1')
      expect(actual.all).toBeNull()
    })

    // addition: a provision that was approved carries the order's currency
    it('an approved provision reads the receipt fields of the provision answer', () => {
      const actual = mapper.map3DPaymentData(
        threeDCases.success1?.threeDResponseData as Data,
        provisionSuccess,
        TX_TYPE.PAY_AUTH,
        ORDER,
      )

      expect(actual.status).toBe('approved')
      expect(turkeyDay(actual.transaction_time as Date)).toBe(turkeyDay(new Date()))
    })

    // addition: the amount of a callback is display text of a strict comma amount, nothing else
    it.each([
      ['10,01', 10.01],
      ['10', null],
      ['10.01', null],
      ['1.000,01', null],
      ['1e3', null],
      ['', null],
      [' 10,01', null],
      [['10,01'], null],
      [{}, null],
      [1001, null],
    ])('callback amount %j reads as %j', (amount, expected) => {
      const callback = { ...(threeDCases.success1?.threeDResponseData as Data), transactionAmount: amount }

      expect(mapper.map3DPaymentData(callback, null, TX_TYPE.PAY_AUTH, ORDER).amount).toBe(expected)
    })

    // addition: a provision answer that is not a success is the bank's decline and echoes no receipt
    it.each([
      ['padded code', { Sonuc: ' 1', Dekont_ID: '3007295376', Siparis_ID: '202412292160' }],
      ['no receipt', { Sonuc: '1', Siparis_ID: '202412292160' }],
      ['zero receipt', { Sonuc: '1', Dekont_ID: '0', Siparis_ID: '202412292160' }],
      ['list receipt', { Sonuc: '1', Dekont_ID: ['3007295376'], Siparis_ID: '202412292160' }],
      ['padded receipt', { Sonuc: '1', Dekont_ID: '3007295376 ', Siparis_ID: '202412292160' }],
    ])('provision with %s is declined', (_name, result) => {
      const answer = { TP_WMD_PayResponse: { TP_WMD_PayResult: { ...result, Bank_Trans_ID: 't', Bank_AuthCode: 'a' } } }

      const actual = mapper.map3DPaymentData(
        threeDCases.success1?.threeDResponseData as Data,
        answer,
        TX_TYPE.PAY_AUTH,
        ORDER,
      )

      expect(actual.status).toBe('declined')
      expect(actual.transaction_id).toBeNull()
      expect(actual.auth_code).toBeNull()
      if (_name !== 'padded code') expect(actual.error_message).toBe('success code without receipt')
    })

    // addition: the bank approved although the 3D result was not a success: declined, flagged for review
    it.each(['0', '2', '4', '7', null, ' 1', ''])(
      'approved provision after mdStatus %j needs manual review',
      (mdStatus) => {
        const callback: Data = { ...(threeDCases.success1?.threeDResponseData as Data), mdStatus }

        const actual: Data = mapper.map3DPaymentData(callback, provisionSuccess, TX_TYPE.PAY_AUTH, ORDER)

        expect(actual.status).toBe('declined')
        expect(actual.requires_manual_review).toBe(true)
        expect(actual.md_status).toBe(mdStatus === '' ? null : mdStatus)
        expect(actual.transaction_id).toBe('24364TKkF16602')
      },
    )

    it('an approved provision after mdStatus 1 is not flagged', () => {
      const actual: Data = mapper.map3DPaymentData(
        threeDCases.success1?.threeDResponseData as Data,
        provisionSuccess,
        TX_TYPE.PAY_AUTH,
        ORDER,
      )

      expect(actual.status).toBe('approved')
      expect(actual).not.toHaveProperty('requires_manual_review')
    })

    it('an unreadable callback maps without error', () => {
      const actual = mapper.map3DPaymentData(null as never, null, TX_TYPE.PAY_AUTH, ORDER)

      expect(actual.status).toBe('declined')
      expect(actual.md_status).toBeNull()
      expect(actual.order_id).toBeNull()
    })
  })

  describe('map3DPayResponseData', () => {
    it.each(Object.entries(threeDPayCases))('%s', (_name, { order, txType, paymentData, expectedData }) => {
      const actual: Data = mapper.map3DPayResponseData(paymentData, txType as never, order as PosOrder)

      if (expectedData.transaction_time instanceof Date) {
        expect((actual.transaction_time as Date).getTime()).toBe(expectedData.transaction_time.getTime())
      } else {
        expect(actual.transaction_time).toBeNull()
      }
      delete actual.transaction_time
      const expected = { ...expectedData }
      delete expected.transaction_time

      takeNonEmpty(actual, 'all')
      expect(sorted(actual)).toStrictEqual(sorted(expected))
    })

    // addition: the account GUID the bank echoes never leaves the mapper
    it.each(Object.entries(threeDPayCases))('%s returns no echoed GUID', (_name, { order, txType, paymentData }) => {
      const input = structuredClone(paymentData)
      const actual = mapper.map3DPayResponseData(paymentData, txType as never, order as PosOrder)

      expect(JSON.stringify(actual)).not.toContain('0c13d406-873b-403b-9c09-a5766840d98c')
      expect((actual.all as Data).TURKPOS_RETVAL_GUID).toBe('***')
      expect(paymentData).toStrictEqual(input)
    })

    it('an empty callback is declined with nulls', () => {
      const actual = mapper.map3DPayResponseData({}, TX_TYPE.PAY_AUTH, ORDER)

      expect(actual.status).toBe('declined')
      expect(actual.payment_model).toBe('3d_pay')
      expect(actual.order_id).toBeNull()
      expect(actual.proc_return_code).toBeNull()
      expect(actual.transaction_time).toBeNull()
    })

    describe('strict approval', () => {
      const callback = threeDPayCases.success1?.paymentData as Data

      it('approves the plain success callback', () => {
        expect(mapper.map3DPayResponseData(callback, TX_TYPE.PAY_AUTH, ORDER).status).toBe('approved')
      })

      // addition: success code and receipt are read exactly as sent
      it.each([
        ['padded code', { TURKPOS_RETVAL_Sonuc: ' 1' }],
        ['fractional code', { TURKPOS_RETVAL_Sonuc: '1.0' }],
        ['list code', { TURKPOS_RETVAL_Sonuc: ['1'] }],
        ['zero receipt', { TURKPOS_RETVAL_Dekont_ID: '0' }],
        ['missing receipt', { TURKPOS_RETVAL_Dekont_ID: undefined }],
        ['list receipt', { TURKPOS_RETVAL_Dekont_ID: ['3007300695'] }],
        ['padded receipt', { TURKPOS_RETVAL_Dekont_ID: ' 3007300695' }],
        ['signed receipt', { TURKPOS_RETVAL_Dekont_ID: '+3007300695' }],
      ])('%s is declined', (_name, override) => {
        const raw: Data = { ...callback, ...override }
        for (const key of Object.keys(raw)) if (raw[key] === undefined) delete raw[key]

        const actual = mapper.map3DPayResponseData(raw, TX_TYPE.PAY_AUTH, ORDER)

        expect(actual.status).toBe('declined')
        expect(actual.order_id).toBeNull()
        expect(actual.masked_number).toBeUndefined()
      })

      it('inherited success fields are declined', () => {
        expect(mapper.map3DPayResponseData(inheritedOnly(callback), TX_TYPE.PAY_AUTH, ORDER).status).toBe('declined')
      })

      // addition: the amount, the currency and the installment count are display values of strict text
      it.each([
        [{ TURKPOS_RETVAL_Tahsilat_Tutari: '10.01' }, { amount: null }],
        [{ TURKPOS_RETVAL_Tahsilat_Tutari: '1e3,00' }, { amount: null }],
        [{ TURKPOS_RETVAL_Tahsilat_Tutari: ['10,01'] }, { amount: null }],
        [{ TURKPOS_RETVAL_PB: 'XXX' }, { currency: null }],
        [{ TURKPOS_RETVAL_PB: { a: 1 } }, { currency: null }],
        [{ TURKPOS_RETVAL_PB: undefined }, { currency: null }],
        [{ TURKPOS_RETVAL_Taksit: 'abc' }, { installment_count: null }],
        [{ TURKPOS_RETVAL_Taksit: '3' }, { installment_count: 3 }],
        [{ TURKPOS_RETVAL_Taksit: undefined }, { installment_count: null }],
        [{ TURKPOS_RETVAL_Islem_Tarih: undefined }, { transaction_time: null }],
        [{ TURKPOS_RETVAL_KK_No: { a: 1 } }, { masked_number: null }],
        [{ TURKPOS_RETVAL_Siparis_ID: ['x'] }, { order_id: null }],
      ])('fields %j read as %j', (override, expected) => {
        const raw: Data = { ...callback, ...override }
        for (const key of Object.keys(raw)) if (raw[key] === undefined) delete raw[key]

        const actual: Data = mapper.map3DPayResponseData(raw, TX_TYPE.PAY_AUTH, ORDER)

        expect(actual.status).toBe('approved')
        for (const [key, value] of Object.entries(expected)) {
          expect(actual[key]).toBe(value)
        }
      })

      // addition: a bank time that cannot be read stops the mapping instead of being guessed
      it.each(['5.1.2025 14:52:20', '05.01.2025 14:52:20'])('time %j parses', (time) => {
        const actual = mapper.map3DPayResponseData(
          { ...callback, TURKPOS_RETVAL_Islem_Tarih: time },
          TX_TYPE.PAY_AUTH,
          ORDER,
        )

        expect((actual.transaction_time as Date).getTime()).toBe(new Date('2025-01-05T14:52:20+03:00').getTime())
      })

      // deviation: a bank time that cannot be read never throws; the field is null, a warning names only the field
      it.each(['32.01.2025 10:00:00', 'not a date', '31.02.2025 10:00:00'])(
        'time %j reads as null and is logged',
        (time) => {
          const actual = mapper.map3DPayResponseData(
            { ...callback, TURKPOS_RETVAL_Islem_Tarih: time },
            TX_TYPE.PAY_AUTH,
            ORDER,
          )

          expect(actual.status).toBe('approved')
          expect(actual.transaction_time).toBeNull()
          expect(warnings).toStrictEqual([['bank timestamp could not be parsed', { field: 'transaction_time' }]])
        },
      )

      it('an approved 3D Host callback with an unreadable time still maps', () => {
        const host = threeDHostCases.success1?.paymentData as Data
        const actual = mapper.map3DHostResponseData(
          { ...host, TURKPOS_RETVAL_Islem_Tarih: '32.01.2025 10:00:00' },
          TX_TYPE.PAY_AUTH,
          ORDER,
        )

        expect(actual.status).toBe('approved')
        expect(actual.transaction_time).toBeNull()
      })

      // addition: success code without a receipt is distinguishable from a bank decline
      it.each([{ TURKPOS_RETVAL_Dekont_ID: '0' }, { TURKPOS_RETVAL_Dekont_ID: ['3007300695'] }])(
        'success code without receipt %j says so',
        (override) => {
          const actual = mapper.map3DPayResponseData({ ...callback, ...override }, TX_TYPE.PAY_AUTH, ORDER)

          expect(actual.status).toBe('declined')
          expect(actual.error_message).toBe('success code without receipt')
        },
      )
    })
  })

  describe('map3DHostResponseData', () => {
    it.each(Object.entries(threeDHostCases))('%s', (_name, { order, txType, paymentData, expectedData }) => {
      const actual: Data = mapper.map3DHostResponseData(paymentData, txType as never, order as PosOrder)

      if (expectedData.transaction_time instanceof Date) {
        expect((actual.transaction_time as Date).getTime()).toBe(expectedData.transaction_time.getTime())
      } else {
        expect(actual.transaction_time).toBeNull()
      }
      delete actual.transaction_time
      const expected = { ...expectedData }
      delete expected.transaction_time

      takeNonEmpty(actual, 'all')
      expect(sorted(actual)).toStrictEqual(sorted(expected))
    })

    // addition: the account GUID the bank echoes never leaves the mapper
    it('returns no echoed GUID', () => {
      const actual = mapper.map3DHostResponseData(
        threeDHostCases.success1?.paymentData as Data,
        TX_TYPE.PAY_AUTH,
        ORDER,
      )

      expect(JSON.stringify(actual)).not.toContain('0c13d406-873b-403b-9c09-a5766840d98c')
    })
  })

  describe('mapStatusResponse', () => {
    it.each(Object.entries(statusCases))('%s', (_name, { responseData, expectedData }) => {
      const actual: Data = mapper.mapStatusResponse(responseData)

      for (const key of ['transaction_time', 'capture_time', 'refund_time', 'cancel_time']) {
        const expectedTime = expectedData[key]
        if (expectedTime instanceof Date) {
          expect((actual[key] as Date).getTime()).toBe(expectedTime.getTime())
        } else {
          expect(actual[key]).toBeNull()
        }
        delete actual[key]
      }
      const expected = { ...expectedData }
      for (const key of ['transaction_time', 'capture_time', 'refund_time', 'cancel_time']) delete expected[key]

      takeNonEmpty(actual, 'all')
      expect(sorted(actual)).toStrictEqual(sorted(expected))
    })

    // addition: an answer that cannot be read is a plain decline
    it.each([{}, null, [], 'text', { TP_Islem_Sorgulama4Response: [] }])(
      'unreadable answer %j is declined',
      (answer) => {
        const actual = mapper.mapStatusResponse(answer as never)

        expect(actual.status).toBe('declined')
        expect(actual.order_id).toBeNull()
        expect(actual.proc_return_code).toBeNull()
        expect(actual.transaction_time).toBeNull()
      },
    )

    describe('records', () => {
      const record: Data =
        statusCases.success_payment?.responseData.TP_Islem_Sorgulama4Response?.TP_Islem_Sorgulama4Result?.DT_Bilgi ?? {}
      const answer = (dtBilgi: unknown, code: unknown = '1'): Data => ({
        TP_Islem_Sorgulama4Response: { TP_Islem_Sorgulama4Result: { DT_Bilgi: dtBilgi, Sonuc: code, Sonuc_Str: 'x' } },
      })

      // addition: a list of records cannot be attributed to the order (P18)
      it('several records are declined as ambiguous', () => {
        const actual = mapper.mapStatusResponse(answer([record, { ...record, Siparis_ID: 'other' }]))

        expect(actual.status).toBe('declined')
        expect(actual.error_message).toBe('ambiguous status record')
        expect(actual.order_id).toBeNull()
        expect(actual.transaction_id).toBeNull()
        expect(actual.first_amount).toBeNull()
      })

      it('a single record in a list is also ambiguous', () => {
        expect(mapper.mapStatusResponse(answer([record])).status).toBe('declined')
      })

      it('a success code without a record is declined', () => {
        const actual = mapper.mapStatusResponse(answer(undefined))

        expect(actual.status).toBe('declined')
        expect(actual.proc_return_code).toBe('1')
        expect(actual.order_id).toBeNull()
      })

      it.each([null, 'text', 5, true])('a record that is %j is declined', (dtBilgi) => {
        expect(mapper.mapStatusResponse(answer(dtBilgi)).status).toBe('declined')
      })

      it.each([' 1', '1.0', ['1'], '0', '-1', null, 'x'])('a record under code %j is declined', (code) => {
        const actual = mapper.mapStatusResponse(answer(record, code))

        expect(actual.status).toBe('declined')
        expect(actual.first_amount).toBeNull()
        expect(actual.auth_code).toBeNull()
      })

      it('an inherited record is declined', () => {
        const result = {
          TP_Islem_Sorgulama4Response: {
            TP_Islem_Sorgulama4Result: inheritedOnly({ DT_Bilgi: record, Sonuc: '1' }),
          },
        }

        expect(mapper.mapStatusResponse(result).status).toBe('declined')
      })

      // addition: the amount of a record is display text of a strict dot amount
      it.each([
        ['10.01', 10.01],
        ['10', 10],
        ['10,01', null],
        ['1e3', null],
        [' 10.01', null],
        [['10.01'], null],
        [undefined, null],
      ])('Toplam_Tutar %j reads as %j', (total, expected) => {
        const dtBilgi: Data = { ...record, Toplam_Tutar: total }
        if (total === undefined) delete dtBilgi.Toplam_Tutar

        const actual = mapper.mapStatusResponse(answer(dtBilgi))

        expect(actual.status).toBe('approved')
        expect(actual.first_amount).toBe(expected)
      })

      // addition: a transaction type that is in no table is no transaction type, never an error
      it.each(['Auth', 'constructor', '', ['SALE'], undefined])('Islem_Tip %j reads as null', (type) => {
        const dtBilgi: Data = { ...record, Islem_Tip: type }

        const actual = mapper.mapStatusResponse(answer(dtBilgi))

        expect(actual.status).toBe('approved')
        expect(actual.transaction_type).toBeNull()
        expect(actual.capture_amount).toBeNull()
      })

      // addition: a state the table does not know is returned as the bank wrote it
      it('an unknown state passes through', () => {
        expect(mapper.mapStatusResponse(answer({ ...record, Durum: 'WAITING' })).order_status).toBe('WAITING')
      })

      // addition: the bank's date with single-digit parts parses; an impossible one is an error
      it('Tarih with a single-digit month parses', () => {
        const actual = mapper.mapStatusResponse(answer({ ...record, Tarih: '5.1.2025 14:52:20' }))

        expect((actual.transaction_time as Date).getTime()).toBe(new Date('2025-01-05T14:52:20+03:00').getTime())
      })

      // deviation: a bank time that cannot be read never throws; the times are null and a warning is logged
      it('an impossible Tarih leaves the times null and still maps', () => {
        const actual = mapper.mapStatusResponse(answer({ ...record, Tarih: '32.01.2025 10:00:00' }))

        expect(actual.status).toBe('approved')
        expect(actual.order_id).toBe('20250105E324')
        expect(actual.transaction_time).toBeNull()
        expect(actual.capture_time).toBeNull()
        expect(warnings).toStrictEqual([['bank timestamp could not be parsed', { field: 'transaction_time' }]])
      })

      it('a missing Tarih leaves the times null', () => {
        const dtBilgi: Data = { ...record }
        delete dtBilgi.Tarih

        const actual = mapper.mapStatusResponse(answer(dtBilgi))

        expect(actual.transaction_time).toBeNull()
        expect(actual.capture_time).toBeNull()
      })

      // addition: non-scalar values in text fields read as null
      it('record and list values in text fields read as null', () => {
        const actual = mapper.mapStatusResponse(
          answer({ ...record, Siparis_ID: { a: 1 }, Bank_Trans_ID: ['t'], KK_No: {}, Bank_AuthCode: [[]] }),
        )

        expect(actual.status).toBe('approved')
        expect(actual.order_id).toBeNull()
        expect(actual.transaction_id).toBeNull()
        expect(actual.masked_number).toBeNull()
        expect(actual.auth_code).toBeNull()
      })
    })
  })

  describe.each([
    ['mapRefundResponse', refundCases],
    ['mapCancelResponse', cancelCases],
  ] as const)('%s', (method, cases) => {
    it.each(Object.entries(cases))('%s', (_name, { responseData, expectedData }) => {
      const actual: Data = mapper[method](responseData)

      takeNonEmpty(actual, 'all')
      expect(actual).toStrictEqual(expectedData)
    })

    // addition: an answer that cannot be read is a plain decline
    it.each([{}, null, [], 'text', { TP_Islem_Iptal_Iade_Kismi2Response: [] }])(
      'unreadable answer %j is declined',
      (answer) => {
        const actual = mapper[method](answer as never)

        expect(actual.status).toBe('declined')
        expect(actual.proc_return_code).toBeNull()
        expect(actual.error_code).toBeNull()
        expect(actual.transaction_id).toBeNull()
      },
    )

    // addition: a padded, fractional, list or inherited code is no success
    it.each([' 1', '1.0', ['1'], true, '9999999999'])('result code %j is declined', (code) => {
      const answer = {
        TP_Islem_Iptal_Iade_Kismi2Response: {
          TP_Islem_Iptal_Iade_Kismi2Result: { Sonuc: code, Bank_AuthCode: 'a', Bank_Trans_ID: 't' },
        },
      }

      const actual = mapper[method](answer)

      expect(actual.status).toBe('declined')
      expect(actual.auth_code).toBeNull()
      expect(actual.transaction_id).toBeNull()
    })

    it('an inherited result code is declined', () => {
      const answer = {
        TP_Islem_Iptal_Iade_Kismi2Response: {
          TP_Islem_Iptal_Iade_Kismi2Result: inheritedOnly({ Sonuc: '1' }),
        },
      }

      expect(mapper[method](answer).status).toBe('declined')
    })

    it('record values in text fields read as null', () => {
      const answer = {
        TP_Islem_Iptal_Iade_Kismi2Response: {
          TP_Islem_Iptal_Iade_Kismi2Result: {
            Sonuc: '1',
            Bank_AuthCode: { a: 1 },
            Bank_Trans_ID: ['t'],
            Bank_HostRefNum: {},
          },
        },
      }

      const actual = mapper[method](answer)

      expect(actual.status).toBe('approved')
      expect(actual.auth_code).toBeNull()
      expect(actual.transaction_id).toBeNull()
      expect(actual.ref_ret_num).toBeNull()
    })
  })

  it('mapOrderHistoryResponse is not supported', () => {
    expect(() => mapper.mapOrderHistoryResponse({})).toThrow(NotImplementedError)
  })

  // addition: a bank card number that slips into the answer never reaches the logger unmasked
  it('logger contexts never contain an unmasked 16-digit card number', () => {
    const pan = '5555444433332222'
    mapper.mapPaymentResponse(
      {
        TP_WMD_UCDResponse: {
          TP_WMD_UCDResult: { Sonuc: '1', Islem_ID: '5', Siparis_ID: pan, Bank_Trans_ID: pan, Sonuc_Str: pan },
        },
      },
      TX_TYPE.PAY_AUTH,
      ORDER,
    )
    mapper.mapPaymentResponse(
      { TP_WMD_UCDResponse: { TP_WMD_UCDResult: { Sonuc: '-1', Sonuc_Str: pan, Bank_HostMsg: pan } } },
      TX_TYPE.PAY_AUTH,
      ORDER,
    )
    mapper.map3DPayResponseData(
      { ...(threeDPayCases.success1?.paymentData as Data), TURKPOS_RETVAL_KK_No: pan, TURKPOS_RETVAL_Siparis_ID: pan },
      TX_TYPE.PAY_AUTH,
      ORDER,
    )
    mapper.map3DPaymentData(
      { ...(threeDCases.success1?.threeDResponseData as Data), orderId: pan },
      provisionSuccess,
      TX_TYPE.PAY_AUTH,
      ORDER,
    )

    expect(logged.length).toBeGreaterThan(0)
    expect(JSON.stringify(logged)).not.toContain(pan)
  })

  it('logger contexts never contain the echoed account GUID', () => {
    mapper.map3DPayResponseData(threeDPayCases.success1?.paymentData as Data, TX_TYPE.PAY_AUTH, ORDER)

    expect(JSON.stringify(logged)).not.toContain('0c13d406-873b-403b-9c09-a5766840d98c')
  })
})
