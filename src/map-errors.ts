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
 * The decorator returned by the no-options form of {@link MapErrors}. It
 * type-checks in every position MapErrors supports — a single method or a whole
 * class (wrapping every instance method) — under both legacy
 * `experimentalDecorators` and TC39 Stage-3.
 */
export interface MapErrorsDecorator {
  /** Legacy method (`experimentalDecorators: true`). */
  (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor): void;
  /** TC39 Stage-3 method. */
  <This, Args extends readonly unknown[], Return>(
    value: (this: This, ...args: Args) => Return,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>,
  ): (this: This, ...args: Args) => Return;
  /** Legacy class. */
  <T extends abstract new (...args: never[]) => unknown>(target: T): void;
  /** TC39 Stage-3 class. */
  <T extends abstract new (...args: never[]) => unknown>(
    target: T,
    context: ClassDecoratorContext<T>,
  ): void;
}

/** Filters for the whole-class form of {@link MapErrors}. */
export interface MapErrorsOptions {
  /** Apply this class's rules only to these methods. Defaults to all of them. */
  readonly include?: readonly string[];
  /** Methods this class's rules should skip; subtracted from the selected set. */
  readonly exclude?: readonly string[];
}

/**
 * The decorator returned by the whole-class form of {@link MapErrors} (when an
 * options object is supplied). Class-only by design: applying it to a method is
 * a type error, since `include`/`exclude` have no meaning there.
 */
export interface MapErrorsClassDecorator {
  /** Legacy class (`experimentalDecorators: true`). */
  <T extends abstract new (...args: never[]) => unknown>(target: T): void;
  /** TC39 Stage-3 class. */
  <T extends abstract new (...args: never[]) => unknown>(
    target: T,
    context: ClassDecoratorContext<T>,
  ): void;
}

const WRAPPED: unique symbol = Symbol("mapErrors.wrapped");
const EMPTY_RULES: readonly ErrorRule[] = [];
const OPTIONS_ON_METHOD =
  "@MapErrors(options, ...rules) decorates a whole class; it cannot target a single method.";

interface WrappedFn extends AnyFunction {
  [WRAPPED]?: true;
}

interface ClassRegistration {
  readonly rules: readonly ErrorRule[];
  readonly applies: (methodName: PropertyKey) => boolean;
}

/**
 * Class-level rule sets, keyed by prototype. Resolution walks the receiver's
 * prototype chain at call time and merges every registration that applies, so a
 * subclass's rules reach methods it inherits.
 */
const classRegistry = new WeakMap<object, ClassRegistration[]>();

/**
 * Method decorator that translates errors thrown by a method according to an
 * ordered rule list (first match wins). Unmatched errors are rethrown as-is, so
 * domain exceptions and genuine bugs pass through untouched. Order rules by
 * specificity: a subclass error rule must precede its superclass rule. Have each
 * rule's `to` pass the original error as `cause` to preserve its stack chain.
 *
 * Apply it to a single method, or to a whole class to wrap every instance
 * method. The class form takes an optional leading options object to narrow the
 * set with `include`/`exclude`:
 *
 * ```ts
 * @MapErrors(rule1, rule2)                        // every instance method
 * @MapErrors({ exclude: ["healthCheck"] }, rule1) // all but healthCheck
 * class Service {}
 * ```
 *
 * When a method is reached by more than one annotation — its own `@MapErrors`,
 * its class's, and any annotated ancestor's — the rule lists are merged
 * most-specific-first (`method > child-class > parent-class`) and the first
 * match wins. The effective list is resolved from the runtime receiver, so a
 * subclass's class-level rules apply to methods it inherits.
 *
 * The wrapper preserves each method's return type — synchronous methods stay
 * synchronous, async methods stay async; rejections are mapped on the promise.
 *
 * Works under both legacy `experimentalDecorators` and TC39 Stage-3 decorators;
 * the returned function detects the standard and the target at runtime.
 */
export function MapErrors<C extends readonly ErrorClass<Error>[]>(
  ...rules: ErrorRules<C>
): MapErrorsDecorator;
export function MapErrors<C extends readonly ErrorClass<Error>[]>(
  options: MapErrorsOptions,
  ...rules: ErrorRules<C>
): MapErrorsClassDecorator;
export function MapErrors(...args: unknown[]): MapErrorsDecorator & MapErrorsClassDecorator {
  const hasOptions = args.length > 0 && !isRule(args[0]);
  const options = (hasOptions ? args[0] : undefined) as MapErrorsOptions | undefined;
  const rules = (hasOptions ? args.slice(1) : args) as readonly ErrorRule[];

  const wrapMethod = (
    original: AnyFunction,
    methodName: PropertyKey,
    methodRules: readonly ErrorRule[],
  ): WrappedFn => {
    const cache = new WeakMap<object, readonly ErrorRule[]>();
    const wrapper: WrappedFn = function (this: unknown, ...callArgs: unknown[]): unknown {
      // Resolve rules lazily — only when an error must actually be mapped — so the
      // success path carries no resolution cost.
      try {
        const result = original.apply(this, callArgs);
        if (isPromiseLike(result)) {
          return result.then(undefined, (error: unknown) => {
            throw translate(error, resolveRules(this, methodName, methodRules, cache));
          });
        }
        return result;
      } catch (error) {
        throw translate(error, resolveRules(this, methodName, methodRules, cache));
      }
    };
    wrapper[WRAPPED] = true;
    return wrapper;
  };

  const decorateClass = (ctor: { readonly prototype: object }): void => {
    const proto = ctor.prototype;
    const applies = makeApplies(proto, options);
    register(proto, { rules, applies });
    for (const name of ownMethodNames(proto)) {
      if (!applies(name)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(proto, name) as PropertyDescriptor;
      if ((descriptor.value as WrappedFn)[WRAPPED]) continue;
      Object.defineProperty(proto, name, {
        ...descriptor,
        value: wrapMethod(descriptor.value as AnyFunction, name, EMPTY_RULES),
      });
    }
  };

  function decorate(a: unknown, b?: unknown, c?: PropertyDescriptor) {
    // Stage-3: the 2nd arg is a context object carrying a string `kind`.
    if (isDecoratorContext(b)) {
      if (b.kind === "class") return decorateClass(a as { prototype: object });
      if (b.kind === "method") {
        if (options) throw new TypeError(OPTIONS_ON_METHOD);
        return wrapMethod(a as AnyFunction, b.name, rules);
      }
      throw new TypeError(`@MapErrors can only decorate methods or classes, not a ${b.kind}.`);
    }
    // Legacy: a class decorator receives the constructor alone (no 2nd arg); a
    // method decorator always receives (target, propertyKey, descriptor).
    if (b === undefined) return decorateClass(a as { prototype: object });
    if (options) throw new TypeError(OPTIONS_ON_METHOD);
    if (!c || typeof c.value !== "function") {
      throw new TypeError("@MapErrors can only decorate methods.");
    }
    c.value = wrapMethod(c.value as AnyFunction, b as PropertyKey, rules);
  }

  return decorate as MapErrorsDecorator & MapErrorsClassDecorator;
}

function translate(error: unknown, rules: readonly ErrorRule[]): unknown {
  for (const rule of rules) {
    if (error instanceof rule.from && (rule.when?.(error) ?? true)) {
      return rule.to(error);
    }
  }
  return error;
}

/**
 * Merge the rule sets that apply to `methodName` on `receiver`: the method's own
 * rules first, then every class registration up the receiver's prototype chain,
 * most-derived first. Memoized per receiver prototype — sound because every class
 * in the chain is registered at decoration time, before any instance method runs.
 */
function resolveRules(
  receiver: unknown,
  methodName: PropertyKey,
  methodRules: readonly ErrorRule[],
  cache: WeakMap<object, readonly ErrorRule[]>,
): readonly ErrorRule[] {
  if (typeof receiver !== "object" || receiver === null) return methodRules;
  const start = Object.getPrototypeOf(receiver) as object | null;
  if (start === null) return methodRules;
  const cached = cache.get(start);
  if (cached !== undefined) return cached;
  const effective: ErrorRule[] = [...methodRules];
  for (let proto: object | null = start; proto !== null; proto = Object.getPrototypeOf(proto)) {
    const registrations = classRegistry.get(proto);
    if (registrations === undefined) continue;
    for (const registration of registrations) {
      if (registration.applies(methodName)) effective.push(...registration.rules);
    }
  }
  cache.set(start, effective);
  return effective;
}

function register(proto: object, registration: ClassRegistration): void {
  const existing = classRegistry.get(proto);
  if (existing) existing.push(registration);
  else classRegistry.set(proto, [registration]);
}

function makeApplies(
  proto: object,
  options: MapErrorsOptions | undefined,
): (name: PropertyKey) => boolean {
  if (!options) return () => true;
  const surface = instanceMethodSurface(proto);
  validateNames(proto, surface, options.include, "include");
  validateNames(proto, surface, options.exclude, "exclude");
  const { include, exclude } = options;
  if (include) {
    const included = new Set<PropertyKey>(include);
    const excluded = new Set<PropertyKey>(exclude ?? []);
    return (name) => included.has(name) && !excluded.has(name);
  }
  if (exclude) {
    const excluded = new Set<PropertyKey>(exclude);
    return (name) => !excluded.has(name);
  }
  return () => true;
}

function validateNames(
  proto: object,
  surface: ReadonlySet<string>,
  names: readonly string[] | undefined,
  label: string,
): void {
  if (names === undefined) return;
  const className = (proto as { constructor: { name: string } }).constructor.name;
  for (const name of names) {
    if (!surface.has(name)) {
      throw new TypeError(
        `@MapErrors: ${label} lists "${name}", which is not an instance method of ${className}.`,
      );
    }
  }
}

/** Own + inherited instance method names reachable on instances of `proto`. */
function instanceMethodSurface(proto: object): ReadonlySet<string> {
  const names = new Set<string>();
  for (let p: object | null = proto; p !== null; p = Object.getPrototypeOf(p)) {
    if (p === Object.prototype) continue;
    for (const name of ownMethodNames(p)) names.add(name);
  }
  return names;
}

function ownMethodNames(proto: object): string[] {
  return Object.getOwnPropertyNames(proto).filter((name) => {
    if (name === "constructor") return false;
    const descriptor = Object.getOwnPropertyDescriptor(proto, name) as PropertyDescriptor;
    return typeof descriptor.value === "function";
  });
}

function isRule(value: unknown): boolean {
  return typeof (value as { from?: unknown }).from === "function";
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
