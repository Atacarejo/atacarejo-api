// tests/helpers/fake-db.ts
// Fake encadeável do cliente Drizzle: qualquer método (select/from/where/insert/values/...)
// devolve a própria cadeia, e o `await` resolve com o próximo resultado da fila
// (ou rejeita, se o resultado for um Error). Nada toca a rede.

export type ChainCall = { method: string; args: unknown[] };

export type FakeDb = {
  /** uma entrada por cadeia iniciada (db.select(...), db.insert(...), ...) */
  chains: ChainCall[][];
  /** enfileira resultados: cada cadeia consome um, na ordem em que é criada */
  queue: (...results: unknown[]) => void;
  /** resultado usado quando a fila está vazia */
  setDefault: (result: unknown) => void;
  reset: () => void;
  /** métodos chamados na cadeia N (ex.: ["insert", "values", "onConflictDoUpdate"]) */
  methods: (n: number) => string[];
  /** argumentos da primeira chamada de `method` na cadeia N */
  argsOf: (n: number, method: string) => unknown[] | undefined;
};

export function createFakeDb(): { db: unknown; fake: FakeDb } {
  const state = { chains: [] as ChainCall[][], results: [] as unknown[], fallback: [] as unknown };

  const startChain = (method: string, args: unknown[]) => {
    const calls: ChainCall[] = [{ method, args }];
    state.chains.push(calls);
    const result = state.results.length ? state.results.shift() : state.fallback;
    const settle = () => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result));

    const proxy: unknown = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") {
            return (onOk?: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) => settle().then(onOk, onErr);
          }
          if (typeof prop === "symbol") return undefined;
          return (...a: unknown[]) => {
            calls.push({ method: prop, args: a });
            return proxy;
          };
        },
      },
    );
    return proxy;
  };

  const db = new Proxy(
    {},
    {
      get(_t, prop) {
        if (typeof prop === "symbol" || prop === "then") return undefined;
        return (...args: unknown[]) => startChain(prop, args);
      },
    },
  );

  const fake: FakeDb = {
    chains: state.chains,
    queue: (...r) => state.results.push(...r),
    setDefault: (r) => {
      state.fallback = r;
    },
    reset: () => {
      state.chains.length = 0;
      state.results.length = 0;
      state.fallback = [];
    },
    methods: (n) => (state.chains[n] ?? []).map((c) => c.method),
    argsOf: (n, method) => state.chains[n]?.find((c) => c.method === method)?.args,
  };

  return { db, fake };
}
