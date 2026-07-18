export function createSessionRunner() {
  const tails = new Map<string, Promise<unknown>>();

  return {
    run<T>(sessionKey: string, operation: () => Promise<T>): Promise<T> {
      const previous = tails.get(sessionKey);
      const current = previous
        ? previous.catch(() => undefined).then(operation)
        : Promise.resolve().then(operation);
      const tail = current.finally(() => {
        if (tails.get(sessionKey) === tail) tails.delete(sessionKey);
      });
      tails.set(sessionKey, tail);
      return current;
    },
    get activeSessions(): number {
      return tails.size;
    }
  };
}
