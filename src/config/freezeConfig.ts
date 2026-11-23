import type { GatewayConfig } from '../gateway/AbstractGateway.js'

/** A shipped bank config: deeply frozen, with its bank keys typed (no `!` or cast needed to read an entry). */
export type ShippedPosConfig<Bank extends string> = {
  readonly banks: { readonly [B in Bank]: Readonly<GatewayConfig> }
}

/** Freezes the config and every nested object, so the shared shipped configs cannot be modified at runtime. */
export function freezeConfig<Bank extends string>(config: {
  banks: Record<Bank, GatewayConfig>
}): ShippedPosConfig<Bank> {
  deepFreeze(config)
  return config
}

function deepFreeze(value: object): void {
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === 'object') {
      deepFreeze(child)
    }
  }
  Object.freeze(value)
}
