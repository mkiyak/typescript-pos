import { isDeepStrictEqual } from 'node:util'
import { PosError } from './errors.js'

/** Runs hooks sequentially (awaiting each) and returns the event, which hooks may mutate. */
export async function runHooks<E>(hooks: Array<(e: E) => void | Promise<void>> | undefined, event: E): Promise<E> {
  if (hooks) {
    for (const hook of hooks) await hook(event)
  }
  return event
}

/**
 * Hands a structured clone of `requestData` to the hooks and reports whether they changed it.
 * Without hooks the input is returned as is. Otherwise a baseline clone and an event clone are made, so that
 * cloning itself (which drops class prototypes) is not mistaken for a change; when nothing changed the original
 * reference is returned.
 *
 * @throws PosError when hooks are registered and the request data cannot be structured-cloned
 */
export async function prepareRequestDataWithHooks<E extends { requestData: Record<string, unknown> }>(
  hooks: Array<(e: E) => void | Promise<void>> | undefined,
  requestData: Record<string, unknown>,
  buildEvent: (clonedRequestData: Record<string, unknown>) => E,
  hookName: string,
): Promise<{ data: Record<string, unknown>; changed: boolean }> {
  if (hooks === undefined || hooks.length === 0) {
    return { data: requestData, changed: false }
  }

  let baseline: Record<string, unknown>
  let eventData: Record<string, unknown>
  try {
    baseline = structuredClone(requestData)
    eventData = structuredClone(requestData)
  } catch (e) {
    throw new PosError(
      `Request data cannot be cloned for ${hookName} hooks: ${e instanceof Error ? e.message : String(e)}`,
      { cause: e },
    )
  }

  const event = buildEvent(eventData)
  await runHooks(hooks, event)

  if (isDeepStrictEqual(baseline, event.requestData)) {
    return { data: requestData, changed: false }
  }

  return { data: event.requestData, changed: true }
}
