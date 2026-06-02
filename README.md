# error-mapper-decorator

[![CI](https://github.com/mquesada02/error-mapper-decorator/actions/workflows/ci.yml/badge.svg)](https://github.com/mquesada02/error-mapper-decorator/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/error-mapper-decorator.svg)](https://www.npmjs.com/package/error-mapper-decorator)
[![npm downloads](https://img.shields.io/npm/dm/error-mapper-decorator.svg)](https://www.npmjs.com/package/error-mapper-decorator)

A tiny, type-safe method decorator that translates errors thrown by a method
according to an ordered, **first-match-wins** rule list. Unmatched errors are
rethrown as-is, so domain exceptions and genuine bugs pass through untouched.

- **Type-safe rules** — each rule's `when`/`to` receives the exact instance type
  of its `from` class, inferred from a variadic tuple. No per-rule casts.
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

Rules are evaluated top to bottom and the first match wins. **A subclass rule
must come before its superclass rule**, otherwise the superclass rule shadows it:

```ts
@MapErrors(
  { from: SpecificError, to: () => new HttpError(409) }, // checked first
  { from: BaseError, to: () => new HttpError(500) },     // catch-all
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

A method decorator factory. Each rule is a plain object:

| Field  | Type                          | Required | Description                                              |
| ------ | ----------------------------- | -------- | -------------------------------------------------------- |
| `from` | `new (...args) => E`          | yes      | Error class to match (via `instanceof`).                 |
| `when` | `(error: E) => boolean`       | no       | Extra guard; rule only fires when this returns `true`.   |
| `to`   | `(error: E) => Error`         | yes      | Maps the caught error to the error to re-throw. Pass the original as `cause` to keep its stack. |

Also exported: the `ErrorRule`, `ErrorClass`, and `MapErrorsDecorator` types.

> **`to` is synchronous by design.** It must produce the replacement error
> immediately so a synchronous method can stay synchronous. For async
> enrichment (e.g. a remote lookup), do it in a separate layer rather than in a
> rule.

## License

MIT
