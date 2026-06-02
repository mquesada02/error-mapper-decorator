# error-mapper-decorator

[![CI](https://github.com/mquesada02/error-mapper-decorator/actions/workflows/ci.yml/badge.svg)](https://github.com/mquesada02/error-mapper-decorator/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/error-mapper-decorator.svg)](https://www.npmjs.com/package/error-mapper-decorator)
[![npm downloads](https://img.shields.io/npm/dm/error-mapper-decorator.svg)](https://www.npmjs.com/package/error-mapper-decorator)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/mquesada02/error-mapper-decorator/badge)](https://scorecard.dev/viewer/?uri=github.com/mquesada02/error-mapper-decorator)

A tiny, type-safe decorator that translates errors thrown by a method — or by
every method of a class — through an ordered list of rules. Unmatched errors are
rethrown as-is, so domain exceptions and genuine bugs pass through untouched.

- **Type-safe rules** — each rule's `when`/`to` receives the exact instance type
  of its `from` class, inferred from a variadic tuple. No per-rule casts.
- **Composable** — by default the rules run as a pipeline, so an `A → B` mapping
  followed by `B → C` turns a thrown `A` into a `C`. Opt out per annotation with
  `{ pipeline: false }`.
- **Sync *and* async** — the wrapper preserves the method's return type. Sync
  methods stay sync; async rejections are mapped on the promise.
- **Both decorator standards** — works under legacy `experimentalDecorators`
  **and** TC39 Stage-3 decorators. One import, detected at runtime.
- **Zero dependencies.**

## Install

```sh
pnpm add error-mapper-decorator
```

## Usage

```ts
import { MapErrors } from "error-mapper-decorator";

type User = { id: string; name: string };

class NotFoundError extends Error {}
class ValidationError extends Error {
  constructor(public readonly field: string) {
    super(`invalid ${field}`);
  }
}
class HttpError extends Error {
  constructor(
    public readonly status: number,
    options?: ErrorOptions,
  ) {
    super(`http ${status}`, options);
  }
}

class UserService {
  @MapErrors(
    // `error` is inferred as ValidationError — `.field` is available, no cast.
    // Pass the caught error as `cause` to keep its stack and message.
    { from: ValidationError, when: (error) => error.field === "email", to: (error) => new HttpError(422, { cause: error }) },
    { from: NotFoundError, to: (error) => new HttpError(404, { cause: error }) },
  )
  async getUser(id: string): Promise<User> {
    // ...
  }
}
```

When `getUser` throws a `ValidationError` on the `email` field it is re-thrown as
`HttpError(422)`; a `NotFoundError` becomes `HttpError(404)`; anything else
propagates unchanged.

### Ordering matters

Rules are applied top to bottom. **Put a subclass rule before its superclass
rule** — otherwise the superclass rule maps the error first, and its result
(a different type) no longer matches the more specific rule below:

```ts
@MapErrors(
  { from: SpecificError, to: () => new HttpError(409) }, // applied first
  { from: BaseError, to: () => new HttpError(500) },     // general fallback
)
```

### Chaining (`pipeline`)

By default the rules form a **pipeline**: each rule whose `from` matches the
current error transforms it and passes the result to the next rule, so mappings
compose (`A → B → C`):

```ts
@MapErrors(
  { from: SqlError, to: (e) => new RepositoryError({ cause: e }) },
  { from: RepositoryError, to: (e) => new ServiceError({ cause: e }) },
)
// a thrown SqlError becomes RepositoryError, then ServiceError — and because
// each `to` forwards `cause`, the full chain is preserved (Service → Repo → Sql).
```

Each rule fires at most once per call, so there are no loops. Because a `to`
normally produces an error in a *different* layer than the inputs (e.g. domain →
HTTP), unrelated rules simply don't match and you get the same result as a single
mapping — the chaining only kicks in when a mapped error is itself the `from` of
a later rule.

Pass `{ pipeline: false }` to stop at the first matching rule instead:

```ts
@MapErrors(
  { pipeline: false },
  { from: ParseError, to: (e) => new RequestError({ cause: e }) },
  { from: RequestError, to: () => new HttpError(400) }, // NOT applied to the line above
)
```

### Guards (`when`)

A rule only fires when its optional `when` predicate returns `true`. If `when`
returns `false`, evaluation continues to the next rule (and falls through to a
plain rethrow if nothing else matches).

### Preserve the original error (`cause`)

`to` returns a brand-new error, so the original's stack and message are lost
unless you forward them. Pass the caught error as the standard `cause` option:

```ts
{ from: QueryError, to: (error) => new RepositoryError("lookup failed", { cause: error }) }
```

Your error class just needs to forward the options to `super`:

```ts
class RepositoryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}
```

The original error is then available as `mappedError.cause` for logging and
debugging.

## Whole-class usage

Apply `@MapErrors` to a **class** to wrap every instance method with the same
rules, instead of annotating each one:

```ts
@MapErrors(
  { from: ValidationError, to: (e) => new HttpError(422, { cause: e }) },
  { from: NotFoundError, to: (e) => new HttpError(404, { cause: e }) },
)
class UserService {
  async getUser(id: string): Promise<User> {
    /* ... */
  }
  async createUser(input: NewUser): Promise<User> {
    /* ... */
  }
}
```

Pass an options object first to narrow the set. `include`/`exclude` are validated
at decoration time — an unknown method name throws:

```ts
@MapErrors({ exclude: ["healthCheck"] }, { from: DbError, to: (e) => new ServiceError({ cause: e }) })
class OrdersService {
  placeOrder() {
    /* wrapped */
  }
  healthCheck() {
    /* left alone */
  }
}
```

The `constructor` and accessors (getters/setters) are never wrapped, and applying
the options form to a single method is a type error.

### How rules combine

When a method is reached by more than one annotation — its own method-level
`@MapErrors`, its class's, and any annotated ancestor's — every applicable rule
list is **merged**, ordered by specificity:

```
method-level  >  child class  >  parent class
```

Nothing is dropped: subclassing only ever *adds* mappings, and the merged list
is evaluated as one pipeline. On a conflict (two levels map the same error type)
the more specific level wins because it is applied first. The most-specific
annotation also decides the `pipeline` mode for the whole merged list.

Because the merged list runs as a single forward pass, a chain that spans levels
only composes when the **producing** rule is at least as specific as the
**consuming** one — a method-level `A → B` feeds a class-level `B → C`, but not
the reverse. (Chains within a single annotation are unaffected: you control the
order.)

The effective list is resolved from the **runtime receiver**, so a subclass's
class-level rules also apply to methods it inherits:

```ts
@MapErrors({ from: DbError, to: (e) => new RepoError({ cause: e }) })
class BaseRepo {
  find() {
    /* throws DbError */
  }
}

@MapErrors({ from: TimeoutError, to: (e) => new RepoError({ cause: e }) })
class UserRepo extends BaseRepo {}

// new UserRepo().find() maps BOTH DbError (from BaseRepo) and TimeoutError
// (from UserRepo) — even though find() is inherited, not overridden.
```

> **Two consequences of prototype-based wrapping.** The class form wraps methods
> on the prototype, so:
>
> - Arrow-function class fields (`handler = async () => {}`) are per-instance and
>   are **not** wrapped — use a normal method, or a method-level `@MapErrors`.
> - If an **un-annotated** subclass overrides a method, the override shadows the
>   base's wrapper and is no longer mapped. Annotate the subclass (even an empty
>   `@MapErrors()` re-wraps the override so inherited rules apply again).

## Examples

Runnable, type-checked examples live in [`examples/`](./examples) and are executed
in CI under both decorator standards, so they never drift from the code:

- [`basic-method.ts`](./examples/basic-method.ts) — method-level mapping, sync + async, `cause`.
- [`whole-class.ts`](./examples/whole-class.ts) — class decoration, `exclude`, inheritance.
- [`pipeline-chaining.ts`](./examples/pipeline-chaining.ts) — pipeline chaining and `{ pipeline: false }`.

Run them with `pnpm examples`.

## Decorator standards

The decorator works with either TypeScript decorator implementation — pick the
one your project uses:

**TC39 Stage-3** (default in TypeScript 5+, no flag needed):

```jsonc
{ "compilerOptions": { "target": "ES2022" } }
```

**Legacy** (`experimentalDecorators`):

```jsonc
{ "compilerOptions": { "experimentalDecorators": true } }
```

No code change is required to switch — the same `@MapErrors(...)` compiles and
runs under both.

## API

### `MapErrors(...rules): MapErrorsDecorator`

### `MapErrors(options, ...rules): MapErrorsClassDecorator`

A decorator factory. With no leading options it decorates a **method** or a
**class** (wrapping every instance method). A leading `options` object may carry
`pipeline` (valid on either) and `include`/`exclude` (**class only** — a type
error on a method). Each rule is a plain object:

| Field  | Type                          | Required | Description                                              |
| ------ | ----------------------------- | -------- | -------------------------------------------------------- |
| `from` | `new (...args) => E`          | yes      | Error class to match (via `instanceof`).                 |
| `when` | `(error: E) => boolean`       | no       | Extra guard; rule only fires when this returns `true`.   |
| `to`   | `(error: E) => Error`         | yes      | Maps the caught error to the error to re-throw. Pass the original as `cause` to keep its stack. |

`options`:

| Field      | Type                | Description                                                                          |
| ---------- | ------------------- | ------------------------------------------------------------------------------------ |
| `pipeline` | `boolean`           | Thread each rule's output into the next (`A → B → C`). Default `true`; `false` stops at the first match. |
| `include`  | `readonly string[]` | Class form only — apply this class's rules to these methods only (default: all).     |
| `exclude`  | `readonly string[]` | Class form only — methods this class's rules should skip.                            |

Also exported: the `ErrorRule`, `ErrorClass`, `MapErrorsOptions`,
`MapErrorsDecorator`, and `MapErrorsClassDecorator` types.

> **`to` is synchronous by design.** It must produce the replacement error
> immediately so a synchronous method can stay synchronous. For async
> enrichment (e.g. a remote lookup), do it in a separate layer rather than in a
> rule.

## License

MIT
