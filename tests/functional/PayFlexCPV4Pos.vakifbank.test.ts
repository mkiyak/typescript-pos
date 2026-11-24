import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { posTestConfig } from '../../src/config/posTestConfig.js'
import { AccountFactory } from '../../src/factory/AccountFactory.js'
import { PosFactory } from '../../src/factory/PosFactory.js'
import { CURRENCY, MODEL, TX_TYPE } from '../../src/PosInterface.js'
import type { PosOrder, ThreeDFormData } from '../../src/types.js'

// Runs against the VakıfBank Common Payment test environment (8443 API gateway). Skipped unless FUNCTIONAL_TESTS=1
// and the credentials below are set; never run in CI. Success/fail URLs must be public HTTPS (the bank WAF rejects
// http://localhost). The bank may also require your server IP to be whitelisted.

const merchantId = process.env.VAKIFBANK_CP_MERCHANT_ID
const password = process.env.VAKIFBANK_CP_PASSWORD
const terminalId = process.env.VAKIFBANK_CP_TERMINAL_ID
const RUN = process.env.FUNCTIONAL_TESTS === '1' && Boolean(merchantId && password && terminalId)

const newOrder = (): PosOrder => {
  const token = randomBytes(6).toString('hex')
  return {
    id: `TSPOSCP${token.toUpperCase()}`,
    amount: 10.01,
    currency: CURRENCY.TRY,
    installment: 0,
    ip: '127.0.0.1',
    success_url: `https://example.com/payflex-cp/success?t=${token}`,
    fail_url: `https://example.com/payflex-cp/fail?t=${token}`,
  }
}

describe.skipIf(!RUN)('PayFlexCPV4Pos against the VakıfBank Common Payment test environment', () => {
  const account = AccountFactory.createPayFlexPosAccount(
    'vakifbank-cp',
    merchantId as string,
    password as string,
    terminalId as string,
  )
  const pos = PosFactory.createPosGateway(account, posTestConfig, { timeoutMs: 30_000 })

  it('registers the payment and returns a GET redirect with a payment token', async () => {
    const form = (await pos.get3DFormData(newOrder(), MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH)) as ThreeDFormData
    expect(form.method).toBe('GET')
    expect(form.gateway.startsWith('https://')).toBe(true)
    expect(form.inputs.Ptkn).toBeTruthy()
  }, 60_000)

  it('reports an unknown transaction as declined', async () => {
    const res = await pos.status({ transaction_id: randomBytes(16).toString('hex'), ip: '127.0.0.1' })
    expect(res.status).toBe('declined')
  }, 60_000)
})
