// Type-level proof that `@MapErrors` compiles and infers correctly under both
// decorator standards. Checked via `tsc --noEmit` against tsconfig.json
// (Stage-3) and tsconfig.legacy.json (experimentalDecorators). Not executed.
import { MapErrors } from "../../src/index";

class NotFoundError extends Error {}
class ValidationError extends Error {
  constructor(public readonly field: string) {
    super(`invalid ${field}`);
  }
}
class HttpError extends Error {
  constructor(public readonly status: number) {
    super(`http ${status}`);
  }
}

class UserService {
  @MapErrors(
    // `error` is inferred as ValidationError — `.field` is available with no cast.
    {
      from: ValidationError,
      when: (error) => error.field === "email",
      to: () => new HttpError(422),
    },
    { from: NotFoundError, to: () => new HttpError(404) },
  )
  async getUser(id: string): Promise<string> {
    if (!id) throw new ValidationError("email");
    throw new NotFoundError("missing");
  }

  @MapErrors({ from: NotFoundError, to: () => new HttpError(404) })
  syncLookup(id: string): number {
    if (!id) throw new NotFoundError("x");
    return id.length;
  }
}

const service = new UserService();
void service.getUser("1");
void service.syncLookup("1");
