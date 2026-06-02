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

// Class form: wrap every instance method with one rule list.
@MapErrors({ from: NotFoundError, to: () => new HttpError(404) })
class Repository {
  load(id: string): number {
    if (!id) throw new NotFoundError("x");
    return id.length;
  }
}

// Class form with options to narrow the set.
@MapErrors({ exclude: ["health"] }, { from: NotFoundError, to: () => new HttpError(404) })
class HealthyService {
  act(): void {}
  health(): void {}
}

// A subclass may carry its own class-level rules.
@MapErrors({ from: ValidationError, to: () => new HttpError(422) })
class AdminService extends HealthyService {}

class Misuse {
  // @ts-expect-error — the options form is class-only and cannot decorate a method.
  @MapErrors({ exclude: [] }, { from: NotFoundError, to: () => new HttpError(404) })
  method(): void {}
}

// The `pipeline` flag, unlike include/exclude, is valid on a method.
class Pipelined {
  @MapErrors({ pipeline: false }, { from: NotFoundError, to: () => new HttpError(404) })
  run(): void {}
}

const service = new UserService();
void service.getUser("1");
void service.syncLookup("1");
void new Repository().load("1");
void new HealthyService().act();
void new AdminService().act();
void new Misuse().method();
void new Pipelined().run();
