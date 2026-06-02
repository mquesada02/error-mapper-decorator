// Real `@MapErrors` usage compiled by tsc under TC39 Stage-3 decorators (the
// default, no experimentalDecorators), then executed against the BUILT package.
// esbuild/vitest cannot emit Stage-3 decorators, so this tsc+node path is the
// only true runtime check for the modern standard. Run via `pnpm test:runtime`.
import assert from "node:assert/strict";
import { MapErrors } from "error-mapper-decorator";

class LowError extends Error {}
class SpecificLowError extends LowError {}
class DomainError extends Error {}

class Service {
  @MapErrors(
    { from: SpecificLowError, to: () => new DomainError("specific") },
    { from: LowError, to: (error) => new DomainError("general", { cause: error }) },
  )
  double(value: number): number {
    if (value < 0) throw new SpecificLowError("negative");
    return value * 2;
  }

  @MapErrors({ from: LowError, to: (error) => new DomainError("async", { cause: error }) })
  async load(value: number): Promise<number> {
    await Promise.resolve();
    if (value < 0) throw new LowError("negative");
    return value;
  }
}

const service = new Service();

const result = service.double(3);
assert.equal(result, 6);
assert.ok(!((result as unknown) instanceof Promise), "sync return must stay sync");
assert.throws(() => service.double(-1), /specific/, "more specific rule applied first");

await assert.rejects(service.load(-1), (error: unknown) => error instanceof DomainError);
assert.equal(await service.load(4), 4);

// Pipeline is the default: a matched rule's output feeds the next, so two hops
// chain (SpecificLowError -> LowError -> DomainError). `pipeline: false` stops.
class Chained {
  @MapErrors(
    { from: SpecificLowError, to: () => new LowError("hop1") },
    { from: LowError, to: (error) => new DomainError("hop2", { cause: error }) },
  )
  run(): void {
    throw new SpecificLowError("start");
  }
}
assert.throws(() => new Chained().run(), /hop2/, "pipeline chains both hops by default");

class NotChained {
  @MapErrors(
    { pipeline: false },
    { from: SpecificLowError, to: () => new LowError("hop1") },
    { from: LowError, to: () => new DomainError("hop2") },
  )
  run(): void {
    throw new SpecificLowError("start");
  }
}
assert.throws(
  () => new NotChained().run(),
  (error: unknown) => error instanceof LowError && !(error instanceof DomainError),
  "pipeline: false stops at the first hop",
);

// Class-level decoration + inheritance: rules resolve from the runtime receiver,
// so a subclass's rules reach methods it inherits (call-time resolution).
@MapErrors({ from: LowError, to: (error) => new DomainError("class", { cause: error }) })
class BaseService {
  base(): string {
    throw new LowError("base");
  }
}

@MapErrors({ from: SpecificLowError, to: () => new DomainError("child") })
class DerivedService extends BaseService {
  derived(): string {
    throw new SpecificLowError("derived");
  }
}

const derived = new DerivedService();
assert.throws(() => derived.base(), /class/, "inherited method mapped by the base class rule");
assert.throws(() => derived.derived(), /child/, "subclass method mapped by its own rule");
assert.throws(
  () => new BaseService().base(),
  (error: unknown) => error instanceof DomainError,
  "base instances are unaffected by the subclass rule",
);

console.log("integration/stage3: OK (methods, pipeline, class decoration, inheritance)");
