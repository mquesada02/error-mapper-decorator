import { describe, expect, it } from "vitest";
import { MapErrors } from "../src/index";

class DbError extends Error {}
class TimeoutError extends Error {}
class AuthError extends Error {}
class AppError extends Error {
  constructor(
    readonly tag: string,
    options?: ErrorOptions,
  ) {
    super(tag, options);
  }
}

// Apply class / method decorators without `@` syntax, synthesizing each
// standard's call shape so both runtime branches run under a single tsconfig.
type Decorator = (...args: any[]) => any;
type ClassLike = { readonly name: string; readonly prototype: object };

function applyLegacyClass(decorator: Decorator, cls: ClassLike): void {
  decorator(cls);
}
function applyStage3Class(decorator: Decorator, cls: ClassLike): void {
  decorator(cls, { kind: "class", name: cls.name });
}
function wrapMethodStage3(decorator: Decorator, proto: object, name: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(proto, name) as PropertyDescriptor;
  const replaced = decorator(descriptor.value, { kind: "method", name });
  Object.defineProperty(proto, name, { ...descriptor, value: replaced });
}

const tagOf = (run: () => void): string | undefined => {
  try {
    run();
  } catch (error) {
    return error instanceof AppError ? error.tag : `unmapped:${(error as Error).constructor.name}`;
  }
  return undefined;
};

const caughtOf = (run: () => void): unknown => {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
};

const classModes = [
  { name: "legacy", applyClass: applyLegacyClass },
  { name: "stage-3", applyClass: applyStage3Class },
] as const;

describe.each(classModes)("MapErrors class form ($name)", ({ applyClass }) => {
  it("wraps every instance method", () => {
    class Repo {
      find() {
        throw new DbError("x");
      }
      ok() {
        return 1;
      }
    }
    applyClass(MapErrors({ from: DbError, to: (e) => new AppError("db", { cause: e }) }), Repo);
    const repo = new Repo();
    expect(() => repo.find()).toThrow(AppError);
    expect(repo.ok()).toBe(1);
  });

  it("maps async rejections", async () => {
    class Repo {
      async load() {
        throw new TimeoutError("t");
      }
    }
    applyClass(MapErrors({ from: TimeoutError, to: () => new AppError("to") }), Repo);
    await expect(new Repo().load()).rejects.toBeInstanceOf(AppError);
  });

  it("skips the constructor and accessors", () => {
    class Repo {
      get computed() {
        return 42;
      }
      run() {
        throw new DbError("x");
      }
    }
    applyClass(MapErrors({ from: DbError, to: () => new AppError("db") }), Repo);
    const repo = new Repo();
    expect(repo.computed).toBe(42);
    expect(() => repo.run()).toThrow(AppError);
  });

  it("keeps wrapped methods non-enumerable", () => {
    class Repo {
      run() {}
    }
    applyClass(MapErrors({ from: DbError, to: () => new AppError("db") }), Repo);
    expect(Object.keys(Repo.prototype)).not.toContain("run");
    const descriptor = Object.getOwnPropertyDescriptor(Repo.prototype, "run");
    expect(descriptor?.enumerable).toBe(false);
  });

  it("rethrows unmatched errors unchanged", () => {
    const original = new AuthError("a");
    class Repo {
      run() {
        throw original;
      }
    }
    applyClass(MapErrors({ from: DbError, to: () => new AppError("db") }), Repo);
    let caught: unknown;
    try {
      new Repo().run();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(original);
  });

  it("include limits which methods the rules map", () => {
    class Repo {
      a() {
        throw new DbError("a");
      }
      b() {
        throw new DbError("b");
      }
    }
    applyClass(
      MapErrors({ include: ["a"] }, { from: DbError, to: () => new AppError("db") }),
      Repo,
    );
    const repo = new Repo();
    expect(tagOf(() => repo.a())).toBe("db");
    expect(tagOf(() => repo.b())).toBe("unmapped:DbError");
  });

  it("exclude skips listed methods", () => {
    class Repo {
      a() {
        throw new DbError("a");
      }
      b() {
        throw new DbError("b");
      }
    }
    applyClass(
      MapErrors({ exclude: ["b"] }, { from: DbError, to: () => new AppError("db") }),
      Repo,
    );
    const repo = new Repo();
    expect(tagOf(() => repo.a())).toBe("db");
    expect(tagOf(() => repo.b())).toBe("unmapped:DbError");
  });

  it("supports include and exclude together", () => {
    class Repo {
      a() {
        throw new DbError("a");
      }
      b() {
        throw new DbError("b");
      }
      c() {
        throw new DbError("c");
      }
    }
    applyClass(
      MapErrors(
        { include: ["a", "b"], exclude: ["b"] },
        { from: DbError, to: () => new AppError("db") },
      ),
      Repo,
    );
    const repo = new Repo();
    expect(tagOf(() => repo.a())).toBe("db");
    expect(tagOf(() => repo.b())).toBe("unmapped:DbError");
    expect(tagOf(() => repo.c())).toBe("unmapped:DbError");
  });

  it("wraps all methods when options are empty", () => {
    class Repo {
      a() {
        throw new DbError("a");
      }
    }
    applyClass(MapErrors({}, { from: DbError, to: () => new AppError("db") }), Repo);
    expect(tagOf(() => new Repo().a())).toBe("db");
  });

  it("throws when include names an unknown method", () => {
    class Repo {
      a() {}
    }
    expect(() =>
      applyClass(
        MapErrors({ include: ["nope"] }, { from: DbError, to: () => new AppError("db") }),
        Repo,
      ),
    ).toThrow(/include lists "nope", which is not an instance method/);
  });

  it("throws when exclude names an unknown method", () => {
    class Repo {
      a() {}
    }
    expect(() =>
      applyClass(
        MapErrors({ exclude: ["nope"] }, { from: DbError, to: () => new AppError("db") }),
        Repo,
      ),
    ).toThrow(/exclude lists "nope", which is not an instance method/);
  });

  it("leaves excluded methods as the original unwrapped function", () => {
    class Repo {
      a() {
        throw new DbError("a");
      }
      b() {
        return 1;
      }
    }
    const originalA = Repo.prototype.a;
    const originalB = Repo.prototype.b;
    applyClass(
      MapErrors({ exclude: ["b"] }, { from: DbError, to: () => new AppError("db") }),
      Repo,
    );
    expect(Repo.prototype.a).not.toBe(originalA); // wrapped
    expect(Repo.prototype.b).toBe(originalB); // skipped, untouched
  });

  it("never wraps the constructor", () => {
    class Repo {
      run() {
        throw new DbError("x");
      }
    }
    applyClass(MapErrors({ from: DbError, to: () => new AppError("db") }), Repo);
    expect(Repo.prototype.constructor).toBe(Repo);
  });

  it("rejects an inherited Object.prototype name in include", () => {
    class Repo {
      a() {}
    }
    expect(() =>
      applyClass(
        MapErrors({ include: ["toString"] }, { from: DbError, to: () => new AppError("db") }),
        Repo,
      ),
    ).toThrow(/toString.*is not an instance method/);
  });

  it("merges a subclass's rules into methods it inherits (call-time)", () => {
    class Base {
      read() {
        throw new DbError("r");
      }
      fetch() {
        throw new TimeoutError("f");
      }
    }
    applyClass(MapErrors({ from: DbError, to: (e) => new AppError("base", { cause: e }) }), Base);

    class Child extends Base {}
    applyClass(
      MapErrors({ from: TimeoutError, to: (e) => new AppError("child", { cause: e }) }),
      Child,
    );

    const child = new Child();
    expect(tagOf(() => child.read())).toBe("base"); // base rule, reached on inherited method
    expect(tagOf(() => child.fetch())).toBe("child"); // child rule reaches inherited fetch
    expect(tagOf(() => new Base().fetch())).toBe("unmapped:TimeoutError"); // base instance unaffected
  });

  it("prefers the more specific (child) rule on a conflict", () => {
    class Base {
      run() {
        throw new DbError("x");
      }
    }
    applyClass(MapErrors({ from: DbError, to: () => new AppError("base") }), Base);

    class Child extends Base {
      override run() {
        throw new DbError("x");
      }
    }
    applyClass(MapErrors({ from: DbError, to: () => new AppError("child") }), Child);

    expect(tagOf(() => new Child().run())).toBe("child");
    expect(tagOf(() => new Base().run())).toBe("base");
  });

  it("lets a subclass exclude an inherited method from its own rules", () => {
    class Base {
      run() {
        throw new DbError("x");
      }
    }
    applyClass(MapErrors({ from: DbError, to: () => new AppError("base") }), Base);

    class Child extends Base {}
    applyClass(
      MapErrors({ exclude: ["run"] }, { from: DbError, to: () => new AppError("child") }),
      Child,
    );

    expect(tagOf(() => new Child().run())).toBe("base"); // child rule skips run → base wins
  });
});

describe("MapErrors resolution details", () => {
  it("orders method > child-class > parent-class", () => {
    class Base {
      run(_error: Error): void {}
    }
    applyStage3Class(MapErrors({ from: DbError, to: () => new AppError("base") }), Base);

    class Child extends Base {
      override run(error: Error): void {
        throw error;
      }
    }
    wrapMethodStage3(
      MapErrors({ from: TimeoutError, to: () => new AppError("method") }),
      Child.prototype,
      "run",
    );
    applyStage3Class(MapErrors({ from: AuthError, to: () => new AppError("child") }), Child);

    const tag = (error: Error) => tagOf(() => new Child().run(error));
    expect(tag(new TimeoutError())).toBe("method");
    expect(tag(new AuthError())).toBe("child");
    expect(tag(new DbError())).toBe("base");
  });

  it("merges multiple class-level annotations on the same class", () => {
    class Repo {
      run(error: Error): void {
        throw error;
      }
    }
    applyStage3Class(MapErrors({ from: DbError, to: () => new AppError("first") }), Repo);
    applyStage3Class(MapErrors({ from: TimeoutError, to: () => new AppError("second") }), Repo);

    const repo = new Repo();
    expect(tagOf(() => repo.run(new DbError()))).toBe("first");
    expect(tagOf(() => repo.run(new TimeoutError()))).toBe("second");
  });

  it("lets the most-specific annotation decide the pipeline mode", () => {
    // Method opts out of pipeline; its mode governs the whole merged list, so the
    // class rule that would chain TimeoutError -> AuthError never fires.
    class OptOut {
      run(error: Error): void {
        throw error;
      }
    }
    wrapMethodStage3(
      MapErrors({ pipeline: false }, { from: DbError, to: () => new TimeoutError("b") }),
      OptOut.prototype,
      "run",
    );
    applyStage3Class(MapErrors({ from: TimeoutError, to: () => new AuthError("c") }), OptOut);
    expect(caughtOf(() => new OptOut().run(new DbError("a")))).toBeInstanceOf(TimeoutError);

    // Same shape, but the method keeps the default pipeline, so the class rule
    // chains in: DbError -> TimeoutError -> AuthError.
    class OptIn {
      run(error: Error): void {
        throw error;
      }
    }
    wrapMethodStage3(
      MapErrors({ from: DbError, to: () => new TimeoutError("b") }),
      OptIn.prototype,
      "run",
    );
    applyStage3Class(MapErrors({ from: TimeoutError, to: () => new AuthError("c") }), OptIn);
    expect(caughtOf(() => new OptIn().run(new DbError("a")))).toBeInstanceOf(AuthError);
  });

  it("takes the pipeline mode from the first (most-specific) annotation", () => {
    class Svc {
      run(error: Error): void {
        throw error;
      }
    }
    // First annotation opts out of the pipeline; the second keeps the default. The
    // first (most-specific) governs, so the merged list stops at the first match
    // (DbError -> TimeoutError) instead of chaining on to AuthError.
    applyStage3Class(
      MapErrors({ pipeline: false }, { from: DbError, to: () => new TimeoutError("b") }),
      Svc,
    );
    applyStage3Class(MapErrors({ from: TimeoutError, to: () => new AuthError("c") }), Svc);
    expect(caughtOf(() => new Svc().run(new DbError("a")))).toBeInstanceOf(TimeoutError);
  });

  it("memoizes resolution across calls", () => {
    class Repo {
      run() {
        throw new DbError("x");
      }
    }
    applyStage3Class(MapErrors({ from: DbError, to: () => new AppError("db") }), Repo);
    const repo = new Repo();
    expect(tagOf(() => repo.run())).toBe("db");
    expect(tagOf(() => repo.run())).toBe("db"); // second call hits the cache
  });

  it("falls back to the method's own rules for a null receiver", () => {
    const decorator: Decorator = MapErrors({ from: DbError, to: () => new AppError("m") });
    const fn = decorator(
      () => {
        throw new DbError("x");
      },
      { kind: "method", name: "m" },
    );
    expect(tagOf(() => fn.call(null))).toBe("m");
  });

  it("falls back to the method's own rules for a null-prototype receiver", () => {
    const decorator: Decorator = MapErrors({ from: DbError, to: () => new AppError("m") });
    const fn = decorator(
      () => {
        throw new DbError("x");
      },
      { kind: "method", name: "m" },
    );
    expect(tagOf(() => fn.call(Object.create(null)))).toBe("m");
  });

  it("with no rules, rethrows everything unchanged", () => {
    const decorator: Decorator = MapErrors();
    const fn = decorator(
      () => {
        throw new DbError("x");
      },
      { kind: "method", name: "m" },
    );
    expect(tagOf(() => fn())).toBe("unmapped:DbError");
  });

  it("does not map an un-annotated subclass override (it shadows the base wrapper)", () => {
    class Base {
      run() {
        throw new DbError("x");
      }
    }
    applyStage3Class(MapErrors({ from: DbError, to: () => new AppError("base") }), Base);

    class Child extends Base {
      override run() {
        throw new DbError("x");
      }
    }
    // Child carries no @MapErrors, so its override is a raw, unwrapped function.
    expect(tagOf(() => new Child().run())).toBe("unmapped:DbError");
    expect(tagOf(() => new Base().run())).toBe("base");
  });
});

describe("MapErrors class misuse guards", () => {
  it("throws when the options form decorates a Stage-3 method", () => {
    const decorator: Decorator = MapErrors(
      { exclude: [] },
      { from: DbError, to: () => new AppError("x") },
    );
    expect(() => decorator(() => 0, { kind: "method", name: "m" })).toThrow(
      /only valid when decorating a class/,
    );
  });

  it("throws when the options form decorates a legacy method", () => {
    const decorator: Decorator = MapErrors(
      { exclude: [] },
      { from: DbError, to: () => new AppError("x") },
    );
    const descriptor: PropertyDescriptor = { value: () => 0, writable: true, configurable: true };
    expect(() => decorator({}, "m", descriptor)).toThrow(/only valid when decorating a class/);
  });

  it("throws when the include form decorates a method", () => {
    const decorator: Decorator = MapErrors(
      { include: [] },
      { from: DbError, to: () => new AppError("x") },
    );
    expect(() => decorator(() => 0, { kind: "method", name: "m" })).toThrow(
      /only valid when decorating a class/,
    );
  });
});

describe("MapErrors pipeline mode", () => {
  const m = { kind: "method", name: "m" };

  it("chains rule outputs by default (A -> B -> C)", () => {
    const decorator: Decorator = MapErrors(
      { from: DbError, to: () => new TimeoutError("b") },
      { from: TimeoutError, to: () => new AuthError("c") },
    );
    const fn = decorator(() => {
      throw new DbError("a");
    }, m);
    expect(caughtOf(() => fn())).toBeInstanceOf(AuthError);
  });

  it("preserves the cause chain through a pipeline", () => {
    class A extends Error {}
    class B extends Error {}
    class C extends Error {}
    const decorator: Decorator = MapErrors(
      { from: A, to: (e) => new B("b", { cause: e }) },
      { from: B, to: (e) => new C("c", { cause: e }) },
    );
    const fn = decorator(() => {
      throw new A("a");
    }, m);
    const caught = caughtOf(() => fn());
    expect(caught).toBeInstanceOf(C);
    expect((caught as Error).cause).toBeInstanceOf(B);
    expect(((caught as Error).cause as Error).cause).toBeInstanceOf(A);
  });

  it("stops mid-pipeline when a later rule does not match the current error", () => {
    const decorator: Decorator = MapErrors(
      { from: DbError, to: () => new TimeoutError("b") },
      { from: AuthError, to: () => new AppError("c") },
    );
    const fn = decorator(() => {
      throw new DbError("a");
    }, m);
    expect(caughtOf(() => fn())).toBeInstanceOf(TimeoutError);
  });

  it("pipeline: false stops at the first match", () => {
    const decorator: Decorator = MapErrors(
      { pipeline: false },
      { from: DbError, to: () => new TimeoutError("b") },
      { from: TimeoutError, to: () => new AuthError("c") },
    );
    const fn = decorator(() => {
      throw new DbError("a");
    }, m);
    expect(caughtOf(() => fn())).toBeInstanceOf(TimeoutError);
  });

  it("pipeline: false rethrows an unmatched error unchanged", () => {
    const original = new AuthError("x");
    const decorator: Decorator = MapErrors(
      { pipeline: false },
      { from: DbError, to: () => new TimeoutError("b") },
    );
    const fn = decorator(() => {
      throw original;
    }, m);
    expect(caughtOf(() => fn())).toBe(original);
  });

  it("fires each rule at most once (no loop on a self-matching subtype)", () => {
    class BaseErr extends Error {}
    class SubErr extends BaseErr {}
    const decorator: Decorator = MapErrors({ from: BaseErr, to: () => new SubErr("x") });
    const fn = decorator(() => {
      throw new BaseErr("x");
    }, m);
    const caught = caughtOf(() => fn());
    expect(caught).toBeInstanceOf(SubErr);
  });

  it("applies pipeline to class methods by default", () => {
    class Svc {
      run() {
        throw new DbError("a");
      }
    }
    applyStage3Class(
      MapErrors(
        { from: DbError, to: () => new TimeoutError("b") },
        { from: TimeoutError, to: () => new AuthError("c") },
      ),
      Svc,
    );
    expect(caughtOf(() => new Svc().run())).toBeInstanceOf(AuthError);
  });

  it("respects pipeline: false on a class", () => {
    class Svc {
      run() {
        throw new DbError("a");
      }
    }
    applyStage3Class(
      MapErrors(
        { pipeline: false },
        { from: DbError, to: () => new TimeoutError("b") },
        { from: TimeoutError, to: () => new AuthError("c") },
      ),
      Svc,
    );
    expect(caughtOf(() => new Svc().run())).toBeInstanceOf(TimeoutError);
  });
});
