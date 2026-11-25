import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { AkbankPosResponseDataMapper } from '../../../src/data-mapper/response/mapper/AkbankPosResponseDataMapper.js'
import { AssecoPosResponseDataMapper } from '../../../src/data-mapper/response/mapper/AssecoPosResponseDataMapper.js'
import { GarantiPosResponseDataMapper } from '../../../src/data-mapper/response/mapper/GarantiPosResponseDataMapper.js'
import { InterPosResponseDataMapper } from '../../../src/data-mapper/response/mapper/InterPosResponseDataMapper.js'
import { IyzicoPosResponseDataMapper } from '../../../src/data-mapper/response/mapper/IyzicoPosResponseDataMapper.js'
import { KuveytPosResponseDataMapper } from '../../../src/data-mapper/response/mapper/KuveytPosResponseDataMapper.js'
import { ParamPosResponseDataMapper } from '../../../src/data-mapper/response/mapper/ParamPosResponseDataMapper.js'
import { PayFlexCPV4PosResponseDataMapper } from '../../../src/data-mapper/response/mapper/PayFlexCPV4PosResponseDataMapper.js'
import { PayFlexV4PosResponseDataMapper } from '../../../src/data-mapper/response/mapper/PayFlexV4PosResponseDataMapper.js'
import { PayForPosResponseDataMapper } from '../../../src/data-mapper/response/mapper/PayForPosResponseDataMapper.js'
import { PayTrPosResponseDataMapper } from '../../../src/data-mapper/response/mapper/PayTrPosResponseDataMapper.js'
import { PosNetPosResponseDataMapper } from '../../../src/data-mapper/response/mapper/PosNetPosResponseDataMapper.js'
import { PosNetV1PosResponseDataMapper } from '../../../src/data-mapper/response/mapper/PosNetV1PosResponseDataMapper.js'
import { ToslaPosResponseDataMapper } from '../../../src/data-mapper/response/mapper/ToslaPosResponseDataMapper.js'
import { VakifKatilimPosResponseDataMapper } from '../../../src/data-mapper/response/mapper/VakifKatilimPosResponseDataMapper.js'
import { AssecoPosResponseValueFormatter } from '../../../src/data-mapper/response/value-formatter/AssecoPosResponseValueFormatter.js'
import { BasicResponseValueFormatter } from '../../../src/data-mapper/response/value-formatter/BasicResponseValueFormatter.js'
import { BoaPosResponseValueFormatter } from '../../../src/data-mapper/response/value-formatter/BoaPosResponseValueFormatter.js'
import { GarantiPosResponseValueFormatter } from '../../../src/data-mapper/response/value-formatter/GarantiPosResponseValueFormatter.js'
import { InterPosResponseValueFormatter } from '../../../src/data-mapper/response/value-formatter/InterPosResponseValueFormatter.js'
import { IyzicoPosResponseValueFormatter } from '../../../src/data-mapper/response/value-formatter/IyzicoPosResponseValueFormatter.js'
import { ParamPosResponseValueFormatter } from '../../../src/data-mapper/response/value-formatter/ParamPosResponseValueFormatter.js'
import { PayTrPosResponseValueFormatter } from '../../../src/data-mapper/response/value-formatter/PayTrPosResponseValueFormatter.js'
import { PosNetPosResponseValueFormatter } from '../../../src/data-mapper/response/value-formatter/PosNetPosResponseValueFormatter.js'
import { ToslaPosResponseValueFormatter } from '../../../src/data-mapper/response/value-formatter/ToslaPosResponseValueFormatter.js'
import { AkbankPosResponseValueMapper } from '../../../src/data-mapper/response/value-mapper/AkbankPosResponseValueMapper.js'
import { AssecoPosResponseValueMapper } from '../../../src/data-mapper/response/value-mapper/AssecoPosResponseValueMapper.js'
import { GarantiPosResponseValueMapper } from '../../../src/data-mapper/response/value-mapper/GarantiPosResponseValueMapper.js'
import { InterPosResponseValueMapper } from '../../../src/data-mapper/response/value-mapper/InterPosResponseValueMapper.js'
import { IyzicoPosResponseValueMapper } from '../../../src/data-mapper/response/value-mapper/IyzicoPosResponseValueMapper.js'
import { KuveytPosResponseValueMapper } from '../../../src/data-mapper/response/value-mapper/KuveytPosResponseValueMapper.js'
import { ParamPosResponseValueMapper } from '../../../src/data-mapper/response/value-mapper/ParamPosResponseValueMapper.js'
import { PayFlexCPV4PosResponseValueMapper } from '../../../src/data-mapper/response/value-mapper/PayFlexCPV4PosResponseValueMapper.js'
import { PayFlexV4PosResponseValueMapper } from '../../../src/data-mapper/response/value-mapper/PayFlexV4PosResponseValueMapper.js'
import { PayForPosResponseValueMapper } from '../../../src/data-mapper/response/value-mapper/PayForPosResponseValueMapper.js'
import { PayTrPosResponseValueMapper } from '../../../src/data-mapper/response/value-mapper/PayTrPosResponseValueMapper.js'
import { PosNetPosResponseValueMapper } from '../../../src/data-mapper/response/value-mapper/PosNetPosResponseValueMapper.js'
import { PosNetV1PosResponseValueMapper } from '../../../src/data-mapper/response/value-mapper/PosNetV1PosResponseValueMapper.js'
import { ToslaPosResponseValueMapper } from '../../../src/data-mapper/response/value-mapper/ToslaPosResponseValueMapper.js'
import { VakifKatilimPosResponseValueMapper } from '../../../src/data-mapper/response/value-mapper/VakifKatilimPosResponseValueMapper.js'
import { NotImplementedError } from '../../../src/errors.js'
import { TX_TYPE, type TxType } from '../../../src/PosInterface.js'
import type { PosOrder } from '../../../src/types.js'
import * as akbank from '../data-mapper/response/mapper/AkbankPosResponseDataMapper.data.js'
import * as asseco from '../data-mapper/response/mapper/AssecoPosResponseDataMapper.data.js'
import * as garanti from '../data-mapper/response/mapper/GarantiPosResponseDataMapper.data.js'
import * as inter from '../data-mapper/response/mapper/InterPosResponseDataMapper.data.js'
import * as iyzico from '../data-mapper/response/mapper/IyzicoPosResponseDataMapper.data.js'
import * as kuveyt from '../data-mapper/response/mapper/KuveytPosResponseDataMapper.data.js'
import * as param from '../data-mapper/response/mapper/ParamPosResponseDataMapper.data.js'
import * as payfor from '../data-mapper/response/mapper/PayForPosResponseDataMapper.data.js'
import * as paytr from '../data-mapper/response/mapper/PayTrPosResponseDataMapper.data.js'
import * as posnet from '../data-mapper/response/mapper/PosNetPosResponseDataMapper.data.js'
import * as posnetV1 from '../data-mapper/response/mapper/PosNetV1PosResponseDataMapper.data.js'
import * as tosla from '../data-mapper/response/mapper/ToslaPosResponseDataMapper.data.js'
import * as vakifKatilim from '../data-mapper/response/mapper/VakifKatilimPosResponseDataMapper.data.js'

// addition: L5 every payment, status, cancel, refund and order-history result of every gateway carries the same
// base keys (own properties, `null` when the bank gave nothing), so merchant code can read them without a gateway switch.

type Data = Record<string, unknown>
type Method = 'payment' | 'status' | 'cancel' | 'refund' | 'history'
type Fixture = { label: string; raw: Data; order?: Data; txType?: string }
type Mapper = {
  mapPaymentResponse(raw: Data, txType: TxType, order: PosOrder): unknown
  mapStatusResponse(raw: Data): unknown
  mapCancelResponse(raw: Data): unknown
  mapRefundResponse(raw: Data): unknown
  mapOrderHistoryResponse(raw: Data): unknown
}

const BASE_KEYS = ['status', 'order_id', 'proc_return_code', 'error_code', 'error_message', 'all'] as const
const ORDER = { id: 'order-1', amount: 1.01, currency: 'TRY', installment: 0 } as unknown as PosOrder

/** Fixture rows of the three provider styles in use: `[label, row][]`, `{ label: row }` and a bare row list. */
function rowsOf(provider: unknown): Fixture[] {
  const entries: Array<[string, Data]> = Array.isArray(provider)
    ? (provider as Array<[string, Data]>)
    : Object.entries(provider as Record<string, Data>)

  return entries.flatMap(([label, row]) => {
    const raw = row.responseData ?? row.input
    if (raw === null || typeof raw !== 'object') return []
    return [
      { label, raw: structuredClone(raw) as Data, order: row.order as Data | undefined, txType: row.txType as string },
    ]
  })
}

const payForHistory = (name: string): Fixture[] => [
  {
    label: name,
    raw: JSON.parse(readFileSync(new URL(`../test_data/payfor/history/${name}`, import.meta.url), 'utf8')) as Data,
  },
]

type Entry = {
  name: string
  make: () => Mapper
  fixtures: Partial<Record<Method, Fixture[]>>
  /** The calls the gateway does not offer: its mapper refuses them, so there is no result to shape. */
  unsupported?: Method[]
}

// A decline and an approve answer of the bank for the gateways whose mapper tests keep their rows inline.
const payFlexV4Status: Fixture[] = [
  {
    label: 'decline',
    raw: {
      ResponseInfo: { Status: 'Error', ResponseCode: '9065', ResponseMessage: 'Uye isyeri bulunamadi' },
    },
  },
  {
    label: 'approve',
    raw: {
      ResponseInfo: { Status: 'Success', ResponseCode: '0000', ResponseMessage: 'Basarili' },
      TransactionSearchResultInfo: {
        TransactionSearchResultList: {
          TransactionSearchResult: {
            AuthCode: '123456',
            OrderId: 'order-1',
            ResultCode: '0000',
            ResultDetail: 'Basarili',
            TransactionId: 'tx-1',
            TransactionType: 'Sale',
            CurrencyAmount: '1.01',
            CurrencyCode: '949',
            Rrn: '123',
            TransactionDate: '2023-03-09T22:10:37',
          },
        },
      },
    },
  },
]
const payFlexV4Money: Fixture[] = [
  { label: 'decline', raw: { ResultCode: '1059', ResultDetail: 'Declined', TransactionId: 'tx-1' } },
  { label: 'approve', raw: { ResultCode: '0000', ResultDetail: 'Basarili', TransactionId: 'tx-1' } },
]
const payFlexV4Payment: Fixture[] = [
  {
    label: 'decline',
    raw: { ResultCode: '0312', ResultDetail: 'RED', TransactionType: 'Sale', TransactionId: 'tx-1' },
    txType: TX_TYPE.PAY_AUTH,
  },
  {
    label: 'approve',
    raw: {
      ResultCode: '0000',
      ResultDetail: 'Basarili',
      TransactionType: 'Sale',
      TransactionId: 'tx-1',
      HostDate: '20230309221037',
      AuthCode: '123456',
      Rrn: '1',
      OrderId: 'order-1',
    },
    txType: TX_TYPE.PAY_AUTH,
  },
]
const cpv4Status: Fixture[] = [
  { label: 'decline', raw: { ErrorCode: '5003', ResponseMessage: 'Islem bulunamadi.' } },
  {
    label: 'approve',
    raw: {
      TransactionId: 'tx-1',
      ResultCode: '0000',
      ResultDetail: 'Basarili',
      OrderID: 'order-1',
      Amount: '1.01',
      CurrencyCode: '949',
      HostDate: '20230309221037',
      ErrorCode: null,
      ResponseMessage: null,
    },
  },
]

const ENTRIES: Entry[] = [
  {
    name: 'AssecoPos',
    make: () =>
      new AssecoPosResponseDataMapper(new AssecoPosResponseValueFormatter(), new AssecoPosResponseValueMapper()),
    fixtures: {
      payment: rowsOf(asseco.paymentTestDataProvider),
      status: [...rowsOf(asseco.statusTestDataProvider), ...rowsOf(asseco.statusRecurringOrderTestDataProvider)],
      cancel: rowsOf(asseco.cancelTestDataProvider),
      refund: rowsOf(asseco.refundTestDataProvider),
      history: rowsOf(asseco.orderHistoryTestDataProvider),
    },
  },
  {
    name: 'PayFlexV4Pos',
    make: () =>
      new PayFlexV4PosResponseDataMapper(new BasicResponseValueFormatter(), new PayFlexV4PosResponseValueMapper()),
    fixtures: { payment: payFlexV4Payment, status: payFlexV4Status, cancel: payFlexV4Money, refund: payFlexV4Money },
    unsupported: ['history'],
  },
  {
    name: 'PayFlexCPV4Pos',
    make: () =>
      new PayFlexCPV4PosResponseDataMapper(new BasicResponseValueFormatter(), new PayFlexCPV4PosResponseValueMapper()),
    fixtures: { status: cpv4Status },
    unsupported: ['payment', 'cancel', 'refund', 'history'],
  },
  {
    name: 'GarantiPos',
    make: () =>
      new GarantiPosResponseDataMapper(new GarantiPosResponseValueFormatter(), new GarantiPosResponseValueMapper()),
    fixtures: {
      payment: rowsOf(garanti.paymentTestDataProvider),
      status: rowsOf(garanti.statusTestDataProvider),
      cancel: rowsOf(garanti.cancelTestDataProvider),
      refund: rowsOf(garanti.refundTestDataProvider),
      history: rowsOf(garanti.orderHistoryTestDataProvider),
    },
  },
  {
    name: 'AkbankPos',
    make: () => new AkbankPosResponseDataMapper(new BasicResponseValueFormatter(), new AkbankPosResponseValueMapper()),
    fixtures: {
      payment: rowsOf(akbank.paymentCases),
      cancel: rowsOf(akbank.cancelCases),
      refund: rowsOf(akbank.refundCases),
      history: rowsOf(akbank.orderHistoryCases),
    },
    unsupported: ['status'],
  },
  {
    name: 'PosNetPos',
    make: () =>
      new PosNetPosResponseDataMapper(new PosNetPosResponseValueFormatter(), new PosNetPosResponseValueMapper()),
    fixtures: {
      payment: rowsOf(posnet.paymentTestDataProvider),
      status: rowsOf(posnet.statusTestDataProvider),
      refund: rowsOf(posnet.refundTestDataProvider),
      cancel: rowsOf(posnet.refundTestDataProvider),
    },
    unsupported: ['history'],
  },
  {
    name: 'PosNetV1Pos',
    make: () =>
      new PosNetV1PosResponseDataMapper(new PosNetPosResponseValueFormatter(), new PosNetV1PosResponseValueMapper()),
    fixtures: {
      payment: rowsOf(posnetV1.paymentTestDataProvider),
      status: rowsOf(posnetV1.statusTestDataProvider),
      cancel: rowsOf(posnetV1.cancelTestDataProvider),
      refund: rowsOf(posnetV1.refundTestDataProvider),
    },
    unsupported: ['history'],
  },
  {
    name: 'PayForPos',
    make: () => new PayForPosResponseDataMapper(new BasicResponseValueFormatter(), new PayForPosResponseValueMapper()),
    fixtures: {
      payment: rowsOf(payfor.paymentTestDataProvider),
      status: rowsOf(payfor.statusTestDataProvider),
      cancel: rowsOf(payfor.cancelTestDataProvider),
      refund: rowsOf(payfor.refundTestDataProvider),
      history: payForHistory('daily_history.json'),
    },
  },
  {
    name: 'InterPos',
    make: () => new InterPosResponseDataMapper(new InterPosResponseValueFormatter(), new InterPosResponseValueMapper()),
    fixtures: {
      payment: rowsOf(inter.paymentTestDataProvider),
      status: rowsOf(inter.statusTestDataProvider),
      cancel: rowsOf(inter.cancelTestDataProvider),
      refund: rowsOf(inter.refundTestDataProvider),
    },
    unsupported: ['history'],
  },
  {
    name: 'KuveytPos',
    make: () => new KuveytPosResponseDataMapper(new BoaPosResponseValueFormatter(), new KuveytPosResponseValueMapper()),
    fixtures: {
      payment: rowsOf(kuveyt.paymentTestDataProvider),
      status: rowsOf(kuveyt.statusTestDataProvider),
      cancel: rowsOf(kuveyt.cancelTestDataProvider),
      refund: rowsOf(kuveyt.refundTestDataProvider),
    },
    unsupported: ['history'],
  },
  {
    name: 'VakifKatilimPos',
    make: () =>
      new VakifKatilimPosResponseDataMapper(
        new BoaPosResponseValueFormatter(),
        new VakifKatilimPosResponseValueMapper(),
      ),
    fixtures: {
      payment: rowsOf(vakifKatilim.paymentTestDataProvider),
      status: rowsOf(vakifKatilim.statusTestDataProvider),
      cancel: rowsOf(vakifKatilim.cancelTestDataProvider),
      refund: rowsOf(vakifKatilim.refundTestDataProvider),
      history: rowsOf(vakifKatilim.orderHistoryTestDataProvider),
    },
  },
  {
    name: 'ToslaPos',
    make: () => new ToslaPosResponseDataMapper(new ToslaPosResponseValueFormatter(), new ToslaPosResponseValueMapper()),
    fixtures: {
      payment: rowsOf(tosla.paymentCases),
      status: rowsOf(tosla.statusCases),
      cancel: rowsOf(tosla.cancelCases),
      refund: rowsOf(tosla.refundCases),
      history: rowsOf(tosla.orderHistoryCases),
    },
  },
  {
    name: 'ParamPos',
    make: () => new ParamPosResponseDataMapper(new ParamPosResponseValueFormatter(), new ParamPosResponseValueMapper()),
    fixtures: {
      payment: rowsOf(param.paymentCases),
      status: rowsOf(param.statusCases),
      cancel: rowsOf(param.cancelCases),
      refund: rowsOf(param.refundCases),
    },
    unsupported: ['history'],
  },
  {
    name: 'PayTrPos',
    make: () => new PayTrPosResponseDataMapper(new PayTrPosResponseValueFormatter(), new PayTrPosResponseValueMapper()),
    fixtures: {
      payment: rowsOf(paytr.paymentCases),
      status: rowsOf(paytr.statusCases),
      refund: rowsOf(paytr.refundCases),
    },
    unsupported: ['cancel', 'history'],
  },
  {
    name: 'IyzicoPos',
    make: () =>
      new IyzicoPosResponseDataMapper(new IyzicoPosResponseValueFormatter(), new IyzicoPosResponseValueMapper()),
    fixtures: {
      payment: rowsOf(iyzico.paymentCases),
      status: rowsOf(iyzico.statusCases),
      cancel: rowsOf(iyzico.cancelCases),
      refund: rowsOf(iyzico.refundCases),
      history: rowsOf(iyzico.orderHistoryCases),
    },
  },
]

function run(mapper: Mapper, method: Method, f: Fixture): Data {
  switch (method) {
    case 'payment':
      return mapper.mapPaymentResponse(
        f.raw,
        (f.txType ?? TX_TYPE.PAY_AUTH) as TxType,
        (f.order ?? ORDER) as unknown as PosOrder,
      ) as Data
    case 'status':
      return mapper.mapStatusResponse(f.raw) as Data
    case 'cancel':
      return mapper.mapCancelResponse(f.raw) as Data
    case 'refund':
      return mapper.mapRefundResponse(f.raw) as Data
    case 'history':
      return mapper.mapOrderHistoryResponse(f.raw) as Data
  }
}

describe('result shape of every gateway (L5)', () => {
  it('covers every gateway that has a mapper', () => {
    expect(ENTRIES.map((e) => e.name).sort()).toStrictEqual(
      [
        'AkbankPos',
        'AssecoPos',
        'GarantiPos',
        'InterPos',
        'IyzicoPos',
        'KuveytPos',
        'ParamPos',
        'PayFlexCPV4Pos',
        'PayFlexV4Pos',
        'PayForPos',
        'PayTrPos',
        'PosNetPos',
        'PosNetV1Pos',
        'ToslaPos',
        'VakifKatilimPos',
      ].sort(),
    )
  })

  for (const entry of ENTRIES) {
    describe(entry.name, () => {
      it('has fixtures or an explicit refusal for every call', () => {
        const methods: Method[] = ['payment', 'status', 'cancel', 'refund', 'history']
        const covered = [...Object.keys(entry.fixtures), ...(entry.unsupported ?? [])].sort()
        expect(covered).toStrictEqual([...methods].sort())
      })

      it.each(entry.unsupported ?? [])('refuses %s', (method) => {
        expect(() => run(entry.make(), method, { label: 'empty', raw: {} })).toThrow(NotImplementedError)
      })

      for (const [method, fixtures] of Object.entries(entry.fixtures) as Array<[Method, Fixture[]]>) {
        it(`has fixtures for ${method}`, () => {
          expect(fixtures.length).toBeGreaterThan(0)
        })

        it.each(fixtures.map((f) => [f.label, f] as const))(`${method}: %s has every base key`, (_label, fixture) => {
          const result = run(entry.make(), method, fixture)

          expect(BASE_KEYS.filter((key) => !Object.hasOwn(result, key))).toStrictEqual([])
          // The PayFor order-history vectors keep `status` null: the verdict belongs to each listed transaction.
          const allowed =
            method === 'history' && entry.name === 'PayForPos'
              ? ['approved', 'declined', null]
              : ['approved', 'declined']
          expect(allowed).toContain(result.status)
          for (const key of ['order_id', 'proc_return_code', 'error_code', 'error_message']) {
            const value = result[key]
            expect(value === null || typeof value === 'string' || typeof value === 'number').toBe(true)
          }
        })
      }
    })
  }
})
