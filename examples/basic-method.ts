// Method-level @MapErrors: translate the errors one method throws into HTTP
// errors, keeping the original as `cause`. Compiled + run by `pnpm examples`.
import assert from "node:assert/strict";
import { MapErrors } from "error-mapper-decorator";

class ValidationError extends Error {
  constructor(readonly field: string) {
    super(`invalid ${field}`);
  }
}
class NotFoundError extends Error {}
class HttpError extends Error {
  constructor(
    readonly status: number,
    options?: ErrorOptions,
  ) {
    super(`http ${status}`, options);
  }
}

class UserService {
  @MapErrors(
    // `error` is inferred as ValidationError here — `.field` is available, no cast.
    {
      from: ValidationError,
      when: (error) => error.field === "email",
      to: (error) => new HttpError(422, { cause: error }),
    },
    { from: NotFoundError, to: (error) => new HttpError(404, { cause: error }) },
  )
  async getUser(id: string): Promise<{ id: string }> {
    if (id === "") throw new ValidationError("email");
    if (id === "missing") throw new NotFoundError(id);
    return { id };
  }
}

const users = new UserService();

console.log("ok:", await users.getUser("alice"));

const validation = await users.getUser("").catch((error: unknown) => error);
assert.ok(validation instanceof HttpError && validation.status === 422);
assert.ok(validation.cause instanceof ValidationError);
console.log(`mapped ValidationError -> HttpError ${validation.status} (cause preserved)`);

const notFound = await users.getUser("missing").catch((error: unknown) => error);
assert.ok(notFound instanceof HttpError && notFound.status === 404);
console.log(`mapped NotFoundError -> HttpError ${notFound.status}`);
