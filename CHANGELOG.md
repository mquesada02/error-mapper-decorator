# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0](https://github.com/mquesada02/error-mapper-decorator/compare/v0.1.1...v0.2.0) (2026-06-02)


### Features

* whole-class decoration and pipeline error chaining ([#13](https://github.com/mquesada02/error-mapper-decorator/issues/13)) ([9f31237](https://github.com/mquesada02/error-mapper-decorator/commit/9f31237c4199cb2e6f90c98a6719966300218b75))

## [0.1.1](https://github.com/mquesada02/error-mapper-decorator/compare/v0.1.0...v0.1.1) (2026-06-02)


### Miscellaneous Chores

* release 0.1.1 ([#11](https://github.com/mquesada02/error-mapper-decorator/issues/11)) ([c8a4647](https://github.com/mquesada02/error-mapper-decorator/commit/c8a4647ef3e17c890cee81c1630e33e72c3f0f92))

## [Unreleased]

## [0.1.0] - 2026-06-02

### Added

- `MapErrors` method decorator that translates thrown errors via an ordered,
  first-match-wins rule list, with per-rule `InstanceType` inference for
  `when`/`to`.
- Support for both legacy `experimentalDecorators` and TC39 Stage-3 decorators
  via runtime standard detection.
- Sync/async-aware wrapping that preserves the method's return type; async
  rejections are mapped on the returned promise.
- Dual ESM + CommonJS build with type definitions for both module systems.

[Unreleased]: https://github.com/mquesada02/error-mapper-decorator/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/mquesada02/error-mapper-decorator/releases/tag/v0.1.0
