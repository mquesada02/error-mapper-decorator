import { describe, expect, it } from "vitest";
import { MapErrors, type MapErrorsDecorator } from "../src/index";

class LowLevelError extends Error {}
class SpecificLowLevelError extends LowLevelError {}
class DomainError extends Error {}
class OtherError extends Error {}

type Method = (this: any, ...args: any[]) => any;

// Apply the decorator without `@` syntax, synthesizing each standard's call
// shape. This exercises both runtime branches under a single tsconfig.
function applyLegacy(decorator: MapErrorsDecorator, fn: Method): Method {
  const descriptor: PropertyDescriptor = {
    value: fn,
    writable: true,
    enumerable: false,
    configurable: true,
  };
  (decorator as (t: object, k: string, d: PropertyDescriptor) => void)({}, "m", descriptor);
  return descriptor.value as Method;
}

function applyStage3(decorator: MapErrorsDecorator, fn: Method): Method {
  const context = { kind: "method", name: "m" } as unknown as ClassMethodDecoratorContext;
  return (decorator as (v: Method, c: ClassMethodDecoratorContext) => Method)(fn, context);
}

const modes = [
  { name: "legacy", apply: applyLegacy },
  { name: "stage-3", apply: applyStage3 },
] as const;

describe.each(modes)("MapErrors ($name decorator)", ({ apply }) => {
  it("maps a matched error via to()", () => {
    const fn = apply(
      MapErrors({ from: LowLevelError, to: () => new DomainError("mapped") }),
      () => {
        throw new LowLevelError("boom");
      },
    );
    expect(() => fn()).toThrow(DomainError);
  });

  it("rethrows an unmatched error as the same instance", () => {
    const original = new OtherError("nope");
    const fn = apply(
      MapErrors({ from: LowLevelError, to: () => new DomainError("mapped") }),
      () => {
        throw original;
      },
    );
    let caught: unknown;
    try {
      fn();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(original);
  });

  it("rethrows non-Error throwables unchanged", () => {
    const fn = apply(MapErrors({ from: LowLevelError, to: () => new DomainError("x") }), () => {
      throw "string-error";
    });
    let caught: unknown;
    try {
      fn();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe("string-error");
  });

  it("honors first-match-wins ordering (subclass before superclass)", () => {
    const fn = apply(
      MapErrors(
        { from: SpecificLowLevelError, to: () => new DomainError("specific") },
        { from: LowLevelError, to: () => new DomainError("general") },
      ),
      () => {
        throw new SpecificLowLevelError("x");
      },
    );
    expect(() => fn()).toThrow("specific");
  });

  it("falls through to the next rule when a guard returns false", () => {
    const decorator = MapErrors(
      {
        from: LowLevelError,
        when: (error) => error.message === "match",
        to: () => new DomainError("guarded"),
      },
      { from: LowLevelError, to: () => new DomainError("fallback") },
    );

    const guarded = apply(decorator, () => {
      throw new LowLevelError("match");
    });
    expect(() => guarded()).toThrow("guarded");

    const fallback = apply(decorator, () => {
      throw new LowLevelError("other");
    });
    expect(() => fallback()).toThrow("fallback");
  });

  it("rethrows unchanged when the only matching rule is guarded out", () => {
    const original = new LowLevelError("other");
    const fn = apply(
      MapErrors({
        from: LowLevelError,
        when: (error) => error.message === "match",
        to: () => new DomainError("x"),
      }),
      () => {
        throw original;
      },
    );
    let caught: unknown;
    try {
      fn();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(original);
  });

  it("preserves a sync return value without wrapping it in a Promise", () => {
    const fn = apply(
      MapErrors({ from: LowLevelError, to: () => new DomainError("x") }),
      (a: number, b: number) => a + b,
    );
    const result = fn(2, 3);
    expect(result).toBe(5);
    expect(result).not.toBeInstanceOf(Promise);
  });

  it("maps async rejections", async () => {
    const fn = apply(
      MapErrors({ from: LowLevelError, to: () => new DomainError("mapped") }),
      async () => {
        throw new LowLevelError("boom");
      },
    );
    await expect(fn()).rejects.toBeInstanceOf(DomainError);
  });

  it("passes async resolutions through unchanged", async () => {
    const fn = apply(
      MapErrors({ from: LowLevelError, to: () => new DomainError("x") }),
      async () => 42,
    );
    await expect(fn()).resolves.toBe(42);
  });

  it("preserves `this` binding", () => {
    const fn = apply(
      MapErrors({ from: LowLevelError, to: () => new DomainError("x") }),
      function (this: { value: number }) {
        return this.value;
      },
    );
    expect(fn.call({ value: 7 })).toBe(7);
  });

  it("passes the matched error instance to to()", () => {
    const thrown = new LowLevelError("boom");
    let received: unknown;
    const fn = apply(
      MapErrors({
        from: LowLevelError,
        to: (error) => {
          received = error;
          return new DomainError("mapped");
        },
      }),
      () => {
        throw thrown;
      },
    );
    expect(() => fn()).toThrow(DomainError);
    expect(received).toBe(thrown);
  });
});

describe("MapErrors misuse guards", () => {
  it("throws a clear error for a non-method Stage-3 context", () => {
    const decorator = MapErrors({ from: LowLevelError, to: () => new DomainError("x") });
    const fieldContext = { kind: "field", name: "x" } as unknown as ClassFieldDecoratorContext;
    expect(() => (decorator as (v: unknown, c: unknown) => unknown)(() => 0, fieldContext)).toThrow(
      /can only decorate methods/,
    );
  });

  it("throws a clear error for a legacy descriptor without a function value", () => {
    const decorator = MapErrors({ from: LowLevelError, to: () => new DomainError("x") });
    const descriptor: PropertyDescriptor = { get: () => 1, configurable: true };
    expect(() =>
      (decorator as (t: object, k: string, d: PropertyDescriptor) => void)({}, "x", descriptor),
    ).toThrow(/can only decorate methods/);
  });
});
