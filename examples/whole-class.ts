// Class-level @MapErrors wraps every instance method with the same rules.
// `exclude` skips methods; a subclass extends the rules (resolved at call time),
// so the base mapping still reaches methods the subclass inherits.
import assert from "node:assert/strict";
import { MapErrors } from "error-mapper-decorator";

class DbError extends Error {}
class TimeoutError extends Error {}
class RepoError extends Error {
  constructor(
    readonly op: string,
    options?: ErrorOptions,
  ) {
    super(op, options);
  }
}

const caught = (run: () => unknown): unknown => {
  try {
    run();
  } catch (error) {
    return error;
  }
};

@MapErrors(
  { exclude: ["healthCheck"] },
  { from: DbError, to: (error) => new RepoError("db", { cause: error }) },
)
class BaseRepo {
  find(): never {
    throw new DbError("connection lost");
  }
  healthCheck(): string {
    return "ok";
  }
}

@MapErrors({ from: TimeoutError, to: (error) => new RepoError("timeout", { cause: error }) })
class UserRepo extends BaseRepo {
  fetch(): never {
    throw new TimeoutError("slow");
  }
}

const repo = new UserRepo();

const dbMapped = caught(() => repo.find());
assert.ok(dbMapped instanceof RepoError && dbMapped.op === "db");

const timeoutMapped = caught(() => repo.fetch());
assert.ok(timeoutMapped instanceof RepoError && timeoutMapped.op === "timeout");

assert.equal(repo.healthCheck(), "ok"); // excluded -> not wrapped
console.log("whole-class: inherited DbError + own TimeoutError mapped; healthCheck excluded");
