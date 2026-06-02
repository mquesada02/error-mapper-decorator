// Real `@MapErrors` usage compiled by tsc under legacy `experimentalDecorators`
// + `emitDecoratorMetadata`, then executed against the BUILT package (../../../dist).
// Proves the decorator runs end-to-end and that DI-style reflect-metadata
// (NestJS/TypeORM) survives the descriptor.value swap. Run via `pnpm test:runtime`.
import "reflect-metadata";
import assert from "node:assert/strict";
import { MapErrors } from "error-mapper-decorator";

class LowError extends Error {}
class DomainError extends Error {}

class Service {
  @MapErrors({ from: LowError, to: (error) => new DomainError("mapped", { cause: error }) })
  handle(value: number): string {
    if (value < 0) throw new LowError("negative");
    return String(value);
  }
}

const service = new Service();

assert.equal(service.handle(5), "5");
assert.ok(!((service.handle(5) as unknown) instanceof Promise), "sync return must stay sync");

let caught: unknown;
try {
  service.handle(-1);
} catch (error) {
  caught = error;
}
assert.ok(caught instanceof DomainError, "LowError mapped to DomainError");
assert.ok((caught as DomainError).cause instanceof LowError, "original preserved as cause");

// design:* metadata is emitted because the method carries a decorator; it must
// still be readable after MapErrors replaces descriptor.value.
const paramTypes = Reflect.getMetadata("design:paramtypes", Service.prototype, "handle");
assert.deepEqual(paramTypes, [Number], "design:paramtypes preserved after wrapping");
const returnType = Reflect.getMetadata("design:returntype", Service.prototype, "handle");
assert.equal(returnType, String, "design:returntype preserved after wrapping");

// Class-level decoration, inherited by an undecorated subclass.
@MapErrors({ from: LowError, to: (error) => new DomainError("class", { cause: error }) })
class BaseService {
  base(): string {
    throw new LowError("base");
  }
}

class DerivedService extends BaseService {}

let inheritedError: unknown;
try {
  new DerivedService().base();
} catch (error) {
  inheritedError = error;
}
assert.ok(inheritedError instanceof DomainError, "inherited method wrapped by the base class rule");

console.log("integration/legacy: OK (behavior, reflect-metadata, class decoration)");
