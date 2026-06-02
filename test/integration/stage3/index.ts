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
assert.throws(() => service.double(-1), /specific/, "subclass rule wins (first match)");

await assert.rejects(service.load(-1), (error: unknown) => error instanceof DomainError);
assert.equal(await service.load(4), 4);

console.log("integration/stage3: OK (sync preserved, ordering, async mapping)");
