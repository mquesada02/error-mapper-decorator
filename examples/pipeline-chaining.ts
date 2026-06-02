// By default rules form a pipeline: each matching rule's output feeds the next,
// so layered mappings compose (SqlError -> RepositoryError -> ServiceError) and
// the `cause` chain is preserved end to end. `{ pipeline: false }` opts out.
import assert from "node:assert/strict";
import { MapErrors } from "error-mapper-decorator";

class SqlError extends Error {}
class RepositoryError extends Error {
  constructor(options?: ErrorOptions) {
    super("repository", options);
  }
}
class ServiceError extends Error {
  constructor(options?: ErrorOptions) {
    super("service", options);
  }
}

const caught = (run: () => unknown): unknown => {
  try {
    run();
  } catch (error) {
    return error;
  }
};

class Service {
  @MapErrors(
    { from: SqlError, to: (error) => new RepositoryError({ cause: error }) },
    { from: RepositoryError, to: (error) => new ServiceError({ cause: error }) },
  )
  run(): never {
    throw new SqlError("deadlock");
  }
}

const chained = caught(() => new Service().run());
assert.ok(chained instanceof ServiceError);
assert.ok(chained.cause instanceof RepositoryError);
assert.ok((chained.cause as RepositoryError).cause instanceof SqlError);
console.log("pipeline (default): SqlError -> RepositoryError -> ServiceError, cause chain intact");

class StopEarly {
  @MapErrors(
    { pipeline: false },
    { from: SqlError, to: (error) => new RepositoryError({ cause: error }) },
    { from: RepositoryError, to: (error) => new ServiceError({ cause: error }) },
  )
  run(): never {
    throw new SqlError("deadlock");
  }
}

const stopped = caught(() => new StopEarly().run());
assert.ok(stopped instanceof RepositoryError && !(stopped instanceof ServiceError));
console.log("pipeline: false -> stops at the first match (RepositoryError)");
