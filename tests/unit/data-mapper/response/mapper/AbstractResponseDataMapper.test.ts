import { describe, expect, it } from 'vitest'
import { AbstractResponseDataMapper } from '../../../../../src/data-mapper/response/mapper/AbstractResponseDataMapper.js'
import { BasicResponseValueFormatter } from '../../../../../src/data-mapper/response/value-formatter/BasicResponseValueFormatter.js'
import { AbstractResponseValueMapper } from '../../../../../src/data-mapper/response/value-mapper/AbstractResponseValueMapper.js'
import { MODEL, type PaymentModel, TX_TYPE, type TxType } from '../../../../../src/PosInterface.js'
import type { PosResponse } from '../../../../../src/types.js'

class VM extends AbstractResponseValueMapper {}

class TestMapper extends AbstractResponseDataMapper {
  mapPaymentResponse = (): PosResponse => this.getDefaultPaymentResponse(TX_TYPE.PAY_AUTH, null)
  map3DPaymentData = (): PosResponse => this.getDefaultPaymentResponse(TX_TYPE.PAY_AUTH, null)
  map3DPayResponseData = (): PosResponse => this.getDefaultPaymentResponse(TX_TYPE.PAY_AUTH, null)
  map3DHostResponseData = (): PosResponse => this.getDefaultPaymentResponse(TX_TYPE.PAY_AUTH, null)
  mapRefundResponse = (raw: Record<string, unknown>): PosResponse => this.getDefaultStatusResponse(raw)
  mapCancelResponse = (raw: Record<string, unknown>): PosResponse => this.getDefaultStatusResponse(raw)
  mapStatusResponse = (raw: Record<string, unknown>): PosResponse => this.getDefaultStatusResponse(raw)
  mapOrderHistoryResponse = (raw: Record<string, unknown>): PosResponse => this.getDefaultStatusResponse(raw)
  extractMdStatus = (raw: Record<string, unknown>): string | null => (raw.mdStatus as string | undefined) ?? null
  is3dAuthSuccess = (md: string | null): boolean => md === '1'
  protected getProcReturnCode(response: Record<string, unknown>): string | null {
    return (response.ProcReturnCode as string | undefined) ?? null
  }

  merge(a: Record<string, unknown>, b: Record<string, unknown>) {
    return this.mergeArraysPreferNonNullValues(a, b)
  }
  empty(d: unknown) {
    return this.emptyStringsToNull(d)
  }
  defaultPayment(t: TxType, m: PaymentModel | null) {
    return this.getDefaultPaymentResponse(t, m)
  }
  defaultHistoryTx() {
    return this.getDefaultOrderHistoryTxResponse()
  }
  procCode(r: Record<string, unknown>) {
    return this.getProcReturnCode(r)
  }
}

describe('AbstractResponseDataMapper', () => {
  const m = new TestMapper(new BasicResponseValueFormatter(), new VM())

  // addition: L3 the gateway reads the result code of a money answer before mapping it
  it('readProcReturnCode returns the result code the mapper decides on', () => {
    expect(m.readProcReturnCode({ ProcReturnCode: '05' })).toBe('05')
    expect(m.readProcReturnCode({})).toBeNull()
    expect(m.readProcReturnCode({ ProcReturnCode: '00' })).toBe(m.procCode({ ProcReturnCode: '00' }))
  })

  it('exposes the constants', () => {
    expect(AbstractResponseDataMapper.PROCEDURE_SUCCESS_CODE).toBe('00')
    expect(AbstractResponseDataMapper.TX_APPROVED).toBe('approved')
    expect(AbstractResponseDataMapper.TX_DECLINED).toBe('declined')
  })

  it('getDefaultPaymentResponse has the expected shape', () => {
    expect(m.defaultPayment(TX_TYPE.PAY_AUTH, MODEL.THREE_D_SECURE)).toStrictEqual({
      order_id: null,
      transaction_id: null,
      transaction_time: null,
      transaction_type: 'pay',
      installment_count: null,
      currency: null,
      amount: null,
      payment_model: '3d',
      auth_code: null,
      ref_ret_num: null,
      batch_num: null,
      proc_return_code: null,
      status: 'declined',
      error_code: null,
      error_message: null,
      all: null,
    })
  })

  it('getDefaultStatusResponse has the expected shape', () => {
    const raw = { a: 1 }
    expect(m.mapStatusResponse(raw)).toStrictEqual({
      order_id: null,
      auth_code: null,
      proc_return_code: null,
      transaction_id: null,
      transaction_time: null,
      capture_time: null,
      error_message: null,
      ref_ret_num: null,
      order_status: null,
      transaction_type: null,
      first_amount: null,
      capture_amount: null,
      status: 'declined',
      error_code: null,
      capture: null,
      currency: null,
      masked_number: null,
      refund_amount: null,
      installment_count: null,
      refund_time: null,
      cancel_time: null,
      all: raw,
    })
  })

  it('getDefaultOrderHistoryTxResponse has the expected shape', () => {
    expect(m.defaultHistoryTx()).toStrictEqual({
      auth_code: null,
      proc_return_code: null,
      transaction_id: null,
      transaction_time: null,
      capture_time: null,
      error_message: null,
      ref_ret_num: null,
      order_status: null,
      transaction_type: null,
      first_amount: null,
      capture_amount: null,
      status: 'declined',
      error_code: null,
      capture: null,
      currency: null,
      masked_number: null,
    })
  })

  it('mergeArraysPreferNonNullValues prefers non-null values, then the second array', () => {
    const merged = m.merge({ a: 1, b: null, c: 3, only1: 'x' }, { a: 2, b: 'B', c: null, only2: null })
    expect(merged).toStrictEqual({ only1: 'x', only2: null, a: 2, b: 'B', c: 3 })
    expect(Object.keys(merged)).toEqual(['only1', 'only2', 'a', 'b', 'c'])
  })

  it('emptyStringsToNull trims, nulls empty strings, keeps numbers, recurses, nulls other scalars', () => {
    expect(m.empty('  ')).toBeNull()
    expect(m.empty(' a ')).toBe('a')
    expect(m.empty(5)).toBe(5)
    expect(m.empty(true)).toBeNull()
    expect(m.empty(null)).toBeNull()
    expect(m.empty({ a: '', b: { c: ' x', d: ['', 1] } })).toStrictEqual({ a: null, b: { c: 'x', d: [null, 1] } })
    // PHP trim() only strips " \t\n\r\0\x0B", not non-breaking spaces
    expect(m.empty(' a ')).toBe(' a ')
    expect(m.empty('\t\n\r\u0000\u000ba\u000b')).toBe('a')
  })

  it('declares getProcReturnCode for subclasses', () => {
    expect(m.procCode({ ProcReturnCode: '00' })).toBe('00')
    expect(m.procCode({})).toBeNull()
  })
})
