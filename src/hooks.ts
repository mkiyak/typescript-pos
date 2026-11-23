/** Runs hooks sequentially (awaiting each) and returns the event, which hooks may mutate. */
export async function runHooks<E>(hooks: Array<(e: E) => void | Promise<void>> | undefined, event: E): Promise<E> {
  if (hooks) {
    for (const hook of hooks) await hook(event)
  }
  return event
}
