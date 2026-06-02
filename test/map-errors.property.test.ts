import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { type ErrorRule, MapErrors } from "../src/index";

class E0 extends Error {}
class E1 extends Error {}
class E2 extends Error {}
class E3 extends Error {}
const CLASSES = [E0, E1, E2, E3] as const;

// Apply @MapErrors to a generated function through its plain legacy call form
// (target, key, descriptor), so the properties can drive it with randomized
// rule lists — exercising the shipped wrapper, not a re-implementation.
function wrap(
  fn: (...args: unknown[]) => unknown,
  rules: ErrorRule[],
  pipeline = true,
): (...args: unknown[]) => unknown {
  const descriptor: PropertyDescriptor = { value: fn, writable: true, configurable: true };
  const decorate = (MapErrors as unknown as (...a: unknown[]) => (...d: unknown[]) => void)(
    { pipeline },
    ...rules,
  );
  decorate({}, "m", descriptor);
  return descriptor.value as (...args: unknown[]) => unknown;
}

function thrownBy(error: unknown): (...args: unknown[]) => unknown {
  return () => {
    throw error;
  };
}

function caught(m: (...args: unknown[]) => unknown): unknown {
  try {
    m();
    return undefined;
  } catch (error) {
    return error;
  }
}

const ruleArb: fc.Arbitrary<ErrorRule> = fc
  .record({
    fromIdx: fc.nat({ max: CLASSES.length - 1 }),
    toIdx: fc.nat({ max: CLASSES.length - 1 }),
    withGuard: fc.boolean(),
    guardPass: fc.boolean(),
  })
  .map(({ fromIdx, toIdx, withGuard, guardPass }) => {
    const From = CLASSES[fromIdx] ?? E0;
    const To = CLASSES[toIdx] ?? E0;
    const to = (error: Error): Error => new To("mapped", { cause: error });
    return withGuard ? { from: From, when: () => guardPass, to } : { from: From, to };
  });

const classIdxArb = fc.nat({ max: CLASSES.length - 1 });
const thrownArb: fc.Arbitrary<Error> = classIdxArb.map((i) => new (CLASSES[i] ?? E0)("boom"));

const RUNS = { numRuns: 50 } as const;

describe("MapErrors invariants (property-based)", () => {
  test("an unmatched error is rethrown as the identical instance", () => {
    fc.assert(
      fc.property(fc.array(ruleArb), thrownArb, (rules, thrown) => {
        const fires = rules.some((r) => thrown instanceof r.from && (r.when?.(thrown) ?? true));
        fc.pre(!fires);
        expect(caught(wrap(thrownBy(thrown), rules))).toBe(thrown);
      }),
      RUNS,
    );
  });

  test("a mapped result is always an Error that chains the original as cause", () => {
    fc.assert(
      fc.property(fc.array(ruleArb), thrownArb, (rules, thrown) => {
        const result = caught(wrap(thrownBy(thrown), rules));
        expect(result).toBeInstanceOf(Error);
        // Every generated `to` forwards { cause }, so any mapping chains back.
        if (result !== thrown) expect((result as Error).cause).toBeDefined();
      }),
      RUNS,
    );
  });

  test("a cyclic ruleset still terminates (each rule fires at most once)", () => {
    const rules: ErrorRule[] = [
      { from: E0, to: (e) => new E1("0->1", { cause: e }) },
      { from: E1, to: (e) => new E0("1->0", { cause: e }) },
    ];
    fc.assert(
      fc.property(thrownArb, (thrown) => {
        expect(caught(wrap(thrownBy(thrown), rules))).toBeInstanceOf(Error);
      }),
      RUNS,
    );
  });

  test("pipeline:false stops at the first matching rule", () => {
    const rules: ErrorRule[] = [
      { from: E0, to: () => new E1("first") },
      { from: E0, to: () => new E2("second") },
    ];
    const result = caught(wrap(thrownBy(new E0("x")), rules, false));
    expect(result).toBeInstanceOf(E1);
    expect(result).not.toBeInstanceOf(E2);
  });

  test("async rejections are mapped on the returned promise", async () => {
    await fc.assert(
      fc.asyncProperty(classIdxArb, async (i) => {
        const Cls = CLASSES[i] ?? E0;
        const rules: ErrorRule[] = [{ from: Cls, to: (e) => new E3("mapped", { cause: e }) }];
        const m = wrap(async () => {
          throw new Cls("boom");
        }, rules) as () => Promise<unknown>;
        await expect(m()).rejects.toBeInstanceOf(E3);
      }),
      RUNS,
    );
  });
});
