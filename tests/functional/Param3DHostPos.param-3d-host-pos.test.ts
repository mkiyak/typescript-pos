import { describe, expect, it } from 'vitest'
import { posTestConfig } from '../../src/config/posTestConfig.js'
import { AccountFactory } from '../../src/factory/AccountFactory.js'
import { PosFactory } from '../../src/factory/PosFactory.js'
import { CURRENCY, MODEL, TX_TYPE } from '../../src/PosInterface.js'
import type { PosOrder, ThreeDFormData } from '../../src/types.js'

// Runs against the Param test environment. Skipped unless FUNCTIONAL_TESTS=1 and PARAMPOS_3DHOST_MERCHANT_ID is set;
// never run in CI. All credentials come from the environment: PARAMPOS_3DHOST_MERCHANT_ID (client code),
// PARAMPOS_3DHOST_USERNAME, PARAMPOS_3DHOST_PASSWORD, PARAMPOS_3DHOST_CLIENT_SECRET (the merchant GUID) and
// PARAMPOS_3DHOST_TERMINAL_ID. Only the form's address, method and input names and the length of the encrypted value
// are printed; the value itself, the credentials and the bank's answer are not.

const RUN = process.env.FUNCTIONAL_TESTS === '1' && Boolean(process.env.PARAMPOS_3DHOST_MERCHANT_ID)

const env = (name: string): string => process.env[name] ?? ''

function createGateway() {
  const account = AccountFactory.createParamPosAccount(
    'param-3d-host-pos',
    env('PARAMPOS_3DHOST_MERCHANT_ID'),
    env('PARAMPOS_3DHOST_USERNAME'),
    env('PARAMPOS_3DHOST_PASSWORD'),
    env('PARAMPOS_3DHOST_CLIENT_SECRET'),
    env('PARAMPOS_3DHOST_TERMINAL_ID'),
  )

  return PosFactory.createPosGateway(account, posTestConfig, { timeoutMs: 30_000 })
}

// Order ids are a letter or digit, then letters, digits, underscore and hyphen (at most 64).
const newOrder = (amount = 10.01): PosOrder => {
  const id = `PH${Date.now()}${Math.floor(Math.random() * 1000)}`
  return {
    id,
    amount,
    currency: CURRENCY.TRY,
    installment: 0,
    success_url: `https://example.com/param/callback?o=${id}`,
  }
}

describe.skipIf(!RUN)('Param3DHostPos against the Param test environment', () => {
  it('a hosted payment is registered and returns the GET form of the hosted page', async () => {
    const pos = createGateway()

    const form = (await pos.get3DFormData(newOrder(), MODEL.THREE_D_HOST, TX_TYPE.PAY_AUTH)) as ThreeDFormData
    const s = form.inputs.s
    console.info('[functional] 3D Host form', form.gateway, form.method, Object.keys(form.inputs), {
      s_length: typeof s === 'string' ? s.length : typeof s,
    })
    expect(form.method).toBe('GET')
    expect(form.gateway).toBe(posTestConfig.banks['param-3d-host-pos'].gateway_endpoints.gateway_3d_host)
    expect(typeof s).toBe('string')
    expect((s as string).length).toBeGreaterThan(0)
  }, 120_000)
})
