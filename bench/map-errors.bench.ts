import { bench, describe } from "vitest";
import { MapErrors } from "../src/index";

class DbError extends Error {}
class ServiceError extends Error {}

const rule = {
  from: DbError,
  to: (error: DbError) => new ServiceError("mapped", { cause: error }),
};

// Apply the decorator through its plain legacy call form (target, key, descriptor)
// so the bench needs no decorator-syntax transform — it measures the exact wrapper
// that ships, not a re-implementation.
function wrap(fn: () => unknown): () => unknown {
  const descriptor: PropertyDescriptor = { value: fn, writable: true, configurable: true };
  MapErrors(rule)({}, "run", descriptor);
  return descriptor.value as () => unknown;
}

// Single-slot sink so the optimizer can't drop the work, without growing memory.
const sink = { value: undefined as unknown };

const rawSuccess = (): number => 42;
const wrappedSuccess = wrap(rawSuccess);

const rawThrow = (): never => {
  throw new DbError("boom");
};
const wrappedThrow = wrap(rawThrow);

// The headline claim: on the success path the wrapper adds ~nothing, because rule
// resolution is lazy — it only runs when an error must actually be mapped.
describe("success path (no error thrown)", () => {
  bench("raw method", () => {
    sink.value = rawSuccess();
  });
  bench("wrapped method", () => {
    sink.value = wrappedSuccess();
  });
});

describe("error-mapping path", () => {
  bench("raw try/catch + instanceof map", () => {
    try {
      rawThrow();
    } catch (error) {
      sink.value = error instanceof DbError ? new ServiceError("mapped", { cause: error }) : error;
    }
  });
  bench("wrapped @MapErrors", () => {
    try {
      wrappedThrow();
    } catch (error) {
      sink.value = error;
    }
  });
});
