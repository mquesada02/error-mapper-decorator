# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0](https://github.com/mquesada02/error-mapper-decorator/compare/error-mapper-decorator-v0.1.0...error-mapper-decorator-v0.2.0) (2026-06-02)


### Features

* add MapErrors error-mapping decorator ([75d3a7e](https://github.com/mquesada02/error-mapper-decorator/commit/75d3a7e721fb69901ff152085dc4daf3084e2830))

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
