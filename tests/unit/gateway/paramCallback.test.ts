import { describe, expect, it, vi } from 'vitest'
import { PosError } from '../../../src/errors.js'
import {
  amountKurus,
  approvalFieldsMalformed,
  callbackCode,
  callbackHash,
  callbackShape,
  confirmedResult,
  flatCallback,
  paramRecordConfirms,
  type RecordExpectations,
  reportsApproval,
  trustedDecline,
  withoutEchoedGuid,
} from '../../../src/gateway/paramCallback.js'
import type { PosResponse } from '../../../src/types.js'

// biome-ignore lint/suspicious/noExplicitAny: fixtures of heterogeneous shape
type Data = Record<string, any>

const logger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })

const MD_APPROVAL: Data = {
  md: '444676:13FDE30917BF65D853787DB838390849D73151A10FC8C1192AC72660F2464521:3473:##190100000',
  mdStatus: '1',
  orderId: '202412292160',
  transactionAmount: '10,01',
  islemGUID: '8b6868fe-a553-4164-a7cc-528461f21759',
  islemHash: 'VW80ENgtqYCWlReB6tyAvqsomb4=',
}

const TURKPOS_APPROVAL: Data = {
  TURKPOS_RETVAL_Islem_ID: '1944A39AD0AEA92E173D665B',
  TURKPOS_RETVAL_Sonuc: '1',
  TURKPOS_RETVAL_Sonuc_Str: 'Odeme Islemi Basarili',
  TURKPOS_RETVAL_GUID: '0c13d406-873b-403b-9c09-a5766840d98c',
  TURKPOS_RETVAL_Dekont_ID: '3007300695',
  TURKPOS_RETVAL_Tahsilat_Tutari: '10,01',
  TURKPOS_RETVAL_Siparis_ID: '20250119BACB',
  TURKPOS_RETVAL_Hash: 'LOpkL9J8vne8E2j0A0HKOhUWGhI=',
}

const record = (over: Data = {}): Data => ({
  Odeme_Sonuc: '1',
  Dekont_ID: '3007300695',
  Siparis_ID: '20250119BACB',
  Islem_ID: '1944A39AD0AEA92E173D665B',
  Durum: 'SUCCESS',
  Tarih: '19.01.2025 17:29:32',
  Toplam_Tutar: '10.01',
  Taksit: '1',
  Toplam_Iade_Tutar: '0',
  KK_No: '581877******2285',
  Islem_Tip: 'SALE',
  Bank_Trans_ID: '25019RcIG10421',
  Bank_AuthCode: '123456',
  Bank_HostRefNum: '501917472738',
  ...over,
})

const statusAnswer = (dt: unknown, sonuc: unknown = '1'): Data => ({
  TP_Islem_Sorgulama4Response: { TP_Islem_Sorgulama4Result: { DT_Bilgi: dt, Sonuc: sonuc, Sonuc_Str: 'Başarılı' } },
})

const EXPECTED: RecordExpectations = {
  siparisId: '20250119BACB',
  dekont: '3007300695',
  kurus: 1001,
  installment: 0,
  transactionType: 'SALE',
}

describe('flatCallback', () => {
  it('accepts a record of strings (and absent values)', () => {
    const data = { a: 'x', b: undefined, c: null }
    expect(flatCallback(data, logger())).toBe(data)
  })

  it.each([
    ['a number', { a: 1 }],
    ['a list', { mdStatus: ['1'] }],
    ['a record', { a: { b: 'c' } }],
    ['a function', { a: () => '1' }],
    ['a boolean', { a: true }],
  ])('refuses %s', (_name, data) => {
    expect(() => flatCallback(data, logger())).toThrow(PosError)
  })

  it('refuses a non-enumerable non-string field and a non-record', () => {
    const data = {}
    Object.defineProperty(data, 'mdStatus', { value: ['1'], enumerable: false })
    expect(() => flatCallback(data, logger())).toThrow(new PosError('3D callback field "mdStatus" must be a string'))
    expect(() => flatCallback(['1'], logger())).toThrow(new PosError('3D callback data must be a record'))
    expect(() => flatCallback(null, logger())).toThrow(PosError)
  })
})

describe('callbackShape', () => {
  it.each([
    [{ mdStatus: '0' }, 'md'],
    [{ islemHash: 'x' }, 'md'],
    [{ TURKPOS_RETVAL_Sonuc: '1' }, 'turkpos'],
    [{ TURKPOS_RETVAL_Hash: 'x' }, 'turkpos'],
  ])('%j is %s', (data, shape) => {
    expect(callbackShape(data)).toBe(shape)
  })

  it.each([
    [{}],
    [{ md: 'x' }],
    [{ mdStatus: '1', TURKPOS_RETVAL_Sonuc: '1' }],
    [{ islemHash: 'x', TURKPOS_RETVAL_Hash: 'y' }],
  ])('refuses %j', (data) => {
    expect(() => callbackShape(data)).toThrow(new PosError('Unexpected 3D callback'))
  })

  it('ignores inherited fields', () => {
    const data = Object.create({ mdStatus: '1' }) as Data
    data.TURKPOS_RETVAL_Sonuc = '1'
    expect(callbackShape(data)).toBe('turkpos')
  })
})

describe('callbackHash', () => {
  it('returns the present, non-empty hash of the shape', () => {
    expect(callbackHash(MD_APPROVAL, 'md')).toBe('VW80ENgtqYCWlReB6tyAvqsomb4=')
    expect(callbackHash(TURKPOS_APPROVAL, 'turkpos')).toBe('LOpkL9J8vne8E2j0A0HKOhUWGhI=')
    expect(callbackHash({ ...MD_APPROVAL, islemHash: '' }, 'md')).toBeUndefined()
    expect(callbackHash({ mdStatus: '1' }, 'md')).toBeUndefined()
    // the other shape's hash field is not this shape's hash
    expect(callbackHash({ TURKPOS_RETVAL_Hash: 'x' }, 'md')).toBeUndefined()
  })
})

describe('reportsApproval', () => {
  it.each([
    [{ mdStatus: '1' }, true],
    [{ mdStatus: ' 1 ' }, true],
    [{ mdStatus: '1\n' }, true],
    [{ mdStatus: '0' }, false],
    [{ mdStatus: '01' }, false],
    [{ mdStatus: '' }, false],
    [{}, false],
  ])('md %j → %s', (data, expected) => {
    expect(reportsApproval(data, 'md')).toBe(expected)
  })

  it.each([
    [{ TURKPOS_RETVAL_Sonuc: '1' }, true],
    [{ TURKPOS_RETVAL_Sonuc: ' 1' }, true],
    [{ TURKPOS_RETVAL_Sonuc: '01' }, true],
    [{ TURKPOS_RETVAL_Sonuc: '1.0' }, true],
    [{ TURKPOS_RETVAL_Sonuc: '+1' }, true],
    [{ TURKPOS_RETVAL_Sonuc: '1e2' }, true],
    [{ TURKPOS_RETVAL_Sonuc: '-1', TURKPOS_RETVAL_Dekont_ID: '0' }, false],
    [{ TURKPOS_RETVAL_Sonuc: '-1', TURKPOS_RETVAL_Dekont_ID: '3007300695' }, true],
    [{ TURKPOS_RETVAL_Sonuc: '0', TURKPOS_RETVAL_Dekont_ID: '0003' }, true],
    [{ TURKPOS_RETVAL_Sonuc: 'x', TURKPOS_RETVAL_Dekont_ID: '' }, false],
    [{ TURKPOS_RETVAL_Sonuc: '0' }, false],
  ])('turkpos %j → %s', (data, expected) => {
    expect(reportsApproval(data, 'turkpos')).toBe(expected)
  })
})

describe('approvalFieldsMalformed', () => {
  it('accepts the CS5 and CP1 approvals', () => {
    expect(approvalFieldsMalformed(MD_APPROVAL, 'md')).toStrictEqual([])
    const { transactionAmount: _t, ...withoutAmount } = MD_APPROVAL
    expect(approvalFieldsMalformed(withoutAmount, 'md')).toStrictEqual([])
    expect(approvalFieldsMalformed(TURKPOS_APPROVAL, 'turkpos')).toStrictEqual([])
  })

  it.each([
    ['mdStatus', ' 1'],
    ['islemGUID', 'not-a-guid'],
    ['md', 'a b'],
    ['md', ''],
    ['md', 'x'.repeat(1025)],
    ['orderId', '-123'],
    ['orderId', ''],
    ['transactionAmount', '10.01'],
    ['transactionAmount', ''],
  ])('md: %s %j is malformed', (field, value) => {
    expect(approvalFieldsMalformed({ ...MD_APPROVAL, [field]: value }, 'md')).toStrictEqual([field])
  })

  it.each([
    ['TURKPOS_RETVAL_Sonuc', '01'],
    ['TURKPOS_RETVAL_Sonuc', '-1'],
    ['TURKPOS_RETVAL_Sonuc', ' 1'],
    ['TURKPOS_RETVAL_Dekont_ID', '0'],
    ['TURKPOS_RETVAL_Dekont_ID', '03007300695'],
    ['TURKPOS_RETVAL_Tahsilat_Tutari', '10.01'],
    ['TURKPOS_RETVAL_Tahsilat_Tutari', '510,01x'],
    ['TURKPOS_RETVAL_Siparis_ID', '_x'],
    ['TURKPOS_RETVAL_Islem_ID', '1944a39ad0aea92e173d665b'],
    ['TURKPOS_RETVAL_Islem_ID', undefined],
  ])('turkpos: %s %j is malformed', (field, value) => {
    expect(approvalFieldsMalformed({ ...TURKPOS_APPROVAL, [field]: value }, 'turkpos')).toStrictEqual([field])
  })
})

describe('callbackCode', () => {
  it.each([
    [{ TURKPOS_RETVAL_Sonuc: '-1' }, '-1'],
    [{ TURKPOS_RETVAL_Sonuc: '1' }, '1'],
    [{ TURKPOS_RETVAL_Sonuc: '-0' }, '0'],
    [{ TURKPOS_RETVAL_Sonuc: ' 1' }, null],
    [{ TURKPOS_RETVAL_Sonuc: 'x' }, null],
    [{}, null],
  ])('%j → %j', (data, code) => {
    expect(callbackCode(data, 'turkpos')).toBe(code)
  })

  it('an md callback has no result code', () => {
    expect(callbackCode({ ...MD_APPROVAL, TURKPOS_RETVAL_Sonuc: '1' }, 'md')).toBeNull()
  })
})

describe('withoutEchoedGuid', () => {
  it('replaces the echoed GUID and leaves the input unchanged', () => {
    const out = withoutEchoedGuid(TURKPOS_APPROVAL)
    expect(out.TURKPOS_RETVAL_GUID).toBe('***')
    expect(TURKPOS_APPROVAL.TURKPOS_RETVAL_GUID).toBe('0c13d406-873b-403b-9c09-a5766840d98c')
    expect(withoutEchoedGuid(MD_APPROVAL)).toBe(MD_APPROVAL)
    expect(withoutEchoedGuid(null)).toBeNull()
  })
})

describe('amountKurus', () => {
  it.each([
    ['10,01', 'comma', 1001],
    ['0,00', 'comma', 0],
    ['1000,25', 'comma', 100025],
    ['10.01', 'comma', null],
    ['10,1', 'comma', null],
    ['10.01', 'dot', 1001],
    ['10.1', 'dot', 1010],
    ['10', 'dot', 1000],
    ['10.0100', 'dot', 1001],
    ['10.015', 'dot', null],
    ['10.0001', 'dot', null],
    ['0', 'dot', 0],
    ['1.000,01', 'comma', null],
    [' 10.01', 'dot', null],
    ['9999999999999.99', 'dot', 999999999999999],
    ['99999999999999', 'dot', null],
  ] as const)('%j (%s) → %j', (text, kind, expected) => {
    expect(amountKurus(text, kind)).toBe(expected)
  })

  it('non-strings are no amount', () => {
    expect(amountKurus(10.01, 'dot')).toBeNull()
    expect(amountKurus(undefined, 'comma')).toBeNull()
  })
})

describe('trustedDecline', () => {
  const mapped = {
    status: 'declined',
    order_id: 'FORGED',
    amount: 1000.01,
    currency: 'TRY',
    proc_return_code: '9',
    error_code: '9',
    error_message: 'mapped text',
    transaction_id: 'T',
    md_status: '0',
    requires_manual_review: true,
    all: { x: 1 },
  } as unknown as PosResponse

  it('md: only the order id, the call, the path and the 3D result remain', () => {
    const callback = { ...MD_APPROVAL, mdStatus: '0' }
    const result = trustedDecline(mapped, callback, 'md', 'ORDER-1', 'pay', '3d')
    expect(result).toStrictEqual({
      status: 'declined',
      order_id: 'ORDER-1',
      amount: null,
      currency: null,
      proc_return_code: null,
      error_code: null,
      error_message: null,
      transaction_id: null,
      md_status: '0',
      transaction_type: 'pay',
      payment_model: '3d',
      all: callback,
      '3d_all': callback,
    })
  })

  it('turkpos: the bank code and a bounded text, the echoed GUID redacted', () => {
    const callback = {
      ...TURKPOS_APPROVAL,
      TURKPOS_RETVAL_Sonuc: '-1',
      TURKPOS_RETVAL_Sonuc_Str: `3D failed ${'x'.repeat(300)}`,
    }
    const result = trustedDecline(mapped, callback, 'turkpos', 'ORDER-1', 'pay', '3d_pay')
    expect(result.status).toBe('declined')
    expect(result.order_id).toBe('ORDER-1')
    expect(result.proc_return_code).toBe('-1')
    expect(result.error_code).toBe('-1')
    expect(result.error_message).toBe(callback.TURKPOS_RETVAL_Sonuc_Str.slice(0, 256))
    expect(result.md_status).toBeNull()
    expect(result.amount).toBeNull()
    expect(result.payment_model).toBe('3d_pay')
    expect(result).not.toHaveProperty('requires_manual_review')
    expect(result).not.toHaveProperty('3d_all')
    expect((result.all as Data).TURKPOS_RETVAL_GUID).toBe('***')
  })

  it('codes that are not integers and empty texts are null', () => {
    const callback = { TURKPOS_RETVAL_Sonuc: '-1x', TURKPOS_RETVAL_Sonuc_Str: '' }
    const result = trustedDecline(mapped, callback, 'turkpos', 'O', 'pay', '3d_pay')
    expect([result.proc_return_code, result.error_code, result.error_message]).toStrictEqual([null, null, null])
  })
})

describe('paramRecordConfirms', () => {
  it('confirms a matching record (evidence)', () => {
    const answer = statusAnswer(record())
    const check = paramRecordConfirms(answer, EXPECTED)
    expect(check.failure).toBeNull()
    expect(check.evidence).toBe(true)
    expect(check.record).toStrictEqual(record())
  })

  it.each([
    ['no answer', {}, ['order_status', 'one status record', 'none'], false],
    ['Sonuc 0', statusAnswer(record(), '0'), ['order_status', 'one status record', 'none'], false],
    ['Sonuc text', statusAnswer(record(), 'x'), ['order_status', 'one status record', 'none'], false],
    ['no DT_Bilgi', statusAnswer(undefined), ['order_status', 'one status record', 'none'], false],
    ['DT_Bilgi list', statusAnswer([record(), record()]), ['order_status', 'one status record', 'list'], false],
    ['DT_Bilgi text', statusAnswer('x'), ['order_status', 'one status record', 'none'], false],
    ['other order', statusAnswer(record({ Siparis_ID: 'OTHER' })), ['order_id', '20250119BACB', 'OTHER'], false],
    ['Durum FAIL', statusAnswer(record({ Durum: 'FAIL' })), ['order_status', 'SUCCESS', 'FAIL'], false],
    ['Odeme_Sonuc 0', statusAnswer(record({ Odeme_Sonuc: '0' })), ['order_status', 'SUCCESS', 'SUCCESS 0'], false],
    ['other receipt', statusAnswer(record({ Dekont_ID: '1' })), ['transaction_id', '3007300695', '1'], true],
    ['receipt malformed', statusAnswer(record({ Dekont_ID: '0' })), ['transaction_id', '3007300695', '0'], false],
    ['pre-auth', statusAnswer(record({ Islem_Tip: 'PRE_AUTH' })), ['transaction_type', 'SALE', 'PRE_AUTH'], true],
    ['amount', statusAnswer(record({ Toplam_Tutar: '1.01' })), ['amount', '1001', '1.01'], true],
    ['amount sub-kuruş', statusAnswer(record({ Toplam_Tutar: '10.011' })), ['amount', '1001', '10.011'], true],
    ['amount comma', statusAnswer(record({ Toplam_Tutar: '10,01' })), ['amount', '1001', '10,01'], true],
    ['refunded', statusAnswer(record({ Toplam_Iade_Tutar: '5.00' })), ['order_status', '0', '5.00'], true],
    ['refund missing', statusAnswer(record({ Toplam_Iade_Tutar: undefined })), ['order_status', '0', ''], true],
    ['installment', statusAnswer(record({ Taksit: '3' })), ['installment', '0', '3'], true],
    ['installment text', statusAnswer(record({ Taksit: 'x' })), ['installment', '0', 'x'], true],
  ] as Array<[string, Data, [string, string, string], boolean]>)(
    '%s fails closed',
    (_name, answer, failure, evidence) => {
      const check = paramRecordConfirms(answer, EXPECTED)
      expect(check.failure).toStrictEqual(failure)
      expect(check.evidence).toBe(evidence)
    },
  )

  it('compares the installment count with one counting as none', () => {
    expect(paramRecordConfirms(statusAnswer(record({ Taksit: '0' })), EXPECTED).failure).toBeNull()
    expect(
      paramRecordConfirms(statusAnswer(record({ Taksit: '3' })), { ...EXPECTED, installment: 3 }).failure,
    ).toBeNull()
  })

  it('a pre-authorization is confirmed by a PRE_AUTH record', () => {
    const answer = statusAnswer(record({ Islem_Tip: 'PRE_AUTH' }))
    expect(paramRecordConfirms(answer, { ...EXPECTED, transactionType: 'PRE_AUTH' }).failure).toBeNull()
  })

  it('checks the transaction id when one is expected, right after the order id', () => {
    const answer = statusAnswer(record({ Toplam_Tutar: '1.00' }))
    expect(paramRecordConfirms(answer, { ...EXPECTED, islemId: 'AAAAAAAAAAAAAAAAAAAAAAAA' }).failure).toStrictEqual([
      'order_id',
      'AAAAAAAAAAAAAAAAAAAAAAAA',
      '1944A39AD0AEA92E173D665B',
    ])
    expect(
      paramRecordConfirms(statusAnswer(record()), { ...EXPECTED, islemId: '1944A39AD0AEA92E173D665B' }).failure,
    ).toBeNull()
  })

  it('reads only own values (a number code counts, inherited fields do not)', () => {
    expect(paramRecordConfirms(statusAnswer(record(), 1), EXPECTED).failure).toBeNull()
    const inherited = Object.create(record()) as Data
    expect(paramRecordConfirms(statusAnswer(inherited), EXPECTED).failure?.[0]).toBe('order_id')
  })
})

describe('confirmedResult', () => {
  it('takes the order values and the record references, nothing from the callback', () => {
    const mapped = {
      status: 'approved',
      order_id: 'FORGED',
      amount: 999,
      currency: 'USD',
      auth_code: 'X',
      masked_number: 'X',
      transaction_time: new Date(0),
      batch_num: 'X',
      proc_return_code: '7',
      error_code: null,
      error_message: null,
      all: {},
    } as unknown as PosResponse
    const time = new Date('2025-01-19T17:29:32+03:00')
    const callback = { ...TURKPOS_APPROVAL }
    const result = confirmedResult(mapped, {
      order: { orderId: 'O1', amount: 10.01, currency: 'TRY' },
      paymentModel: '3d_pay',
      txType: 'pay',
      code: '1',
      mdStatus: null,
      record: record(),
      transactionTime: time,
      all: callback,
      threeDAll: null,
    })
    expect(result).toStrictEqual({
      status: 'approved',
      order_id: 'O1',
      amount: 10.01,
      currency: 'TRY',
      auth_code: '123456',
      ref_ret_num: '501917472738',
      transaction_id: '25019RcIG10421',
      masked_number: '581877******2285',
      installment_count: 0,
      transaction_time: time,
      batch_num: null,
      proc_return_code: '1',
      error_code: null,
      error_message: null,
      md_status: null,
      payment_model: '3d_pay',
      transaction_type: 'pay',
      all: { ...callback, TURKPOS_RETVAL_GUID: '***' },
    })
  })

  it('reads references as own strings only', () => {
    const result = confirmedResult({ status: 'approved' } as unknown as PosResponse, {
      order: { orderId: 'O1', amount: 1, currency: 'TRY' },
      paymentModel: '3d',
      txType: 'pre',
      code: '1',
      mdStatus: '1',
      record: { Bank_AuthCode: 1, KK_No: ['x'], Taksit: '6' },
      transactionTime: null,
      all: { a: '1' },
      threeDAll: { TURKPOS_RETVAL_GUID: 'g' },
    })
    expect(result.auth_code).toBeNull()
    expect(result.masked_number).toBeNull()
    expect(result.installment_count).toBe(6)
    expect(result.md_status).toBe('1')
    expect(result['3d_all']).toStrictEqual({ TURKPOS_RETVAL_GUID: '***' })
  })
})
