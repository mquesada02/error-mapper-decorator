type AnyFunction = (this: unknown, ...args: unknown[]) => unknown;

/** Constructor of a concrete `Error` subclass. */
export type ErrorClass<E extends Error = Error> = new (...args: never[]) => E;

/** A single translation rule. First matching rule wins. */
export interface ErrorRule<E extends Error = Error> {
  readonly from: ErrorClass<E>;
  readonly when?: (error: E) => boolean;
  /**
   * Maps the caught error to the error to re-throw. Pass the original as
   * `cause` to preserve its stack and message chain:
   * `to: (error) => new DomainError("...", { cause: error })`.
   */
  readonly to: (error: E) => Error;
}

/**
 * Variadic-tuple rule list. The mapped type infers the concrete error class
 * per position, so `when`/`to` receive that class's instance type with no
 * per-rule helper.
 */
type ErrorRules<C extends readonly ErrorClass<Error>[]> = {
  readonly [K in keyof C]: {
    readonly from: C[K];
    readonly when?: (error: InstanceType<C[K]>) => boolean;
    readonly to: (error: InstanceType<C[K]>) => Error;
  };
};

/**
 * The decorator returned by {@link MapErrors}. Carries both call signatures so
 * it type-checks under legacy `experimentalDecorators` and TC39 Stage-3.
 */
export interface MapErrorsDecorator {
  /** Legacy (`experimentalDecorators: true`). */
  (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor): void;
  /** TC39 Stage-3. */
  <This, Args extends readonly unknown[], Return>(
    value: (this: This, ...args: Args) => Return,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>,
  ): (this: This, ...args: Args) => Return;
}

/**
 * Method decorator that translates errors thrown by the method according to an
 * ordered rule list (first match wins). Unmatched errors are rethrown as-is, so
 * domain exceptions and genuine bugs pass through untouched. Order by
 * specificity: a subclass rule must precede its superclass rule. Have each
 * rule's `to` pass the original error as `cause` to preserve its stack chain.
 *
 * The wrapper preserves the method's return type — synchronous methods stay
 * synchronous, async methods stay async; rejections are mapped on the promise.
 *
 * Works under both legacy `experimentalDecorators` and TC39 Stage-3 decorators;
 * the returned function detects which standard invoked it at runtime.
 */
export function MapErrors<C extends readonly ErrorClass<Error>[]>(
  ...rules: ErrorRules<C>
): MapErrorsDecorator {
  const ruleList = rules as readonly ErrorRule[];

  const translate = (error: unknown): unknown => {
    for (const rule of ruleList) {
      if (error instanceof rule.from && (rule.when?.(error) ?? true)) {
        return rule.to(error);
      }
    }
    return error;
  };

  const wrap = (original: AnyFunction): AnyFunction =>
    function (this: unknown, ...args: unknown[]): unknown {
      try {
        const result = original.apply(this, args);
        if (isPromiseLike(result)) {
          return result.then(undefined, (error: unknown) => {
            throw translate(error);
          });
        }
        return result;
      } catch (error) {
        throw translate(error);
      }
    };

  function decorate(a: unknown, b: unknown, c?: PropertyDescriptor) {
    // Distinguish the two decorator standards by call shape. A Stage-3 method
    // decorator is called as (value, context) where context is an object with a
    // string `kind`. A legacy decorator is called as (target, propertyKey,
    // descriptor) where the 2nd arg is always a string|symbol — even for static
    // methods, whose legacy target is the constructor — so it can never be
    // mistaken for a Stage-3 context. The detection is therefore unambiguous.
    if (isDecoratorContext(b)) {
      if (b.kind !== "method") {
        throw new TypeError(`@MapErrors can only decorate methods, not a ${b.kind}.`);
      }
      return wrap(a as AnyFunction);
    }
    if (!c || typeof c.value !== "function") {
      throw new TypeError("@MapErrors can only decorate methods.");
    }
    c.value = wrap(c.value as AnyFunction);
  }

  return decorate as MapErrorsDecorator;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function isDecoratorContext(value: unknown): value is DecoratorContext {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { kind?: unknown }).kind === "string"
  );
}
