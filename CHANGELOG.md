# Changelog

## [0.4.0](https://github.com/kendrick/unbranded-starter/compare/v0.3.0...v0.4.0) (2026-07-04)


### Features

* add core-node-version unit and packageManager merge support ([dc34bff](https://github.com/kendrick/unbranded-starter/commit/dc34bff555d8b95909f063f081788859b1ba64d4)), closes [#21](https://github.com/kendrick/unbranded-starter/issues/21)
* add unbranded doctor read-only repo audit ([f08bbaa](https://github.com/kendrick/unbranded-starter/commit/f08bbaa37dd9f60c5be8aa48460a7cef0179aa30)), closes [#20](https://github.com/kendrick/unbranded-starter/issues/20)
* make .unbranded.json self-describing for agents ([b114bf6](https://github.com/kendrick/unbranded-starter/commit/b114bf624d9d8983cb7680c8683662f8e06ee4ed))
* offer to save an interactive run as a recipe ([2069194](https://github.com/kendrick/unbranded-starter/commit/2069194d931514feaf8e0107405e39db72474557)), closes [#23](https://github.com/kendrick/unbranded-starter/issues/23)
* ship gitattributes, vscode, and CI scaffold units ([b088376](https://github.com/kendrick/unbranded-starter/commit/b08837602353fc46756edd2deee0ae9554fd06de)), closes [#22](https://github.com/kendrick/unbranded-starter/issues/22)
* track scaffolded files and add unbranded diff ([f7adbc6](https://github.com/kendrick/unbranded-starter/commit/f7adbc6b6de99e3be1a321e2093509afcddacbe7)), closes [#18](https://github.com/kendrick/unbranded-starter/issues/18)
* warn on a dirty git tree before writing ([19de002](https://github.com/kendrick/unbranded-starter/commit/19de002e9db0ab26cb9933c6903d2ac335c8daf8)), closes [#19](https://github.com/kendrick/unbranded-starter/issues/19)


### Bug Fixes

* realign doctor and diff with v0.4's unit changes ([ff9912a](https://github.com/kendrick/unbranded-starter/commit/ff9912ade51553b56026e89af85fb4b9586b175d))

## [0.3.0](https://github.com/kendrick/unbranded-starter/compare/v0.2.0...v0.3.0) (2026-07-02)


### Features

* accept "." to scaffold into the current directory ([a6f907a](https://github.com/kendrick/unbranded-starter/commit/a6f907adfe2c8da9cf1e6be1b909775bcb1deddb)), closes [#11](https://github.com/kendrick/unbranded-starter/issues/11)
* add --dry-run so a run can be previewed without touching disk ([4f0ec0d](https://github.com/kendrick/unbranded-starter/commit/4f0ec0d9305ed94e7218efd24f04289cf5aedc5d)), closes [#13](https://github.com/kendrick/unbranded-starter/issues/13)
* add --target and let --pm override interactive detection ([4d8ae12](https://github.com/kendrick/unbranded-starter/commit/4d8ae125e940e683add52f06d164d72995a9337a)), closes [#17](https://github.com/kendrick/unbranded-starter/issues/17)
* add `unbranded list` so units are discoverable without the source ([bbb9f17](https://github.com/kendrick/unbranded-starter/commit/bbb9f1746c139a6bb95a22ca9b2684d7dc5efa89)), closes [#15](https://github.com/kendrick/unbranded-starter/issues/15)
* honor FileOp.mode so merge-json and append-if-missing actually run ([2915c2f](https://github.com/kendrick/unbranded-starter/commit/2915c2fbd63eab31806b5ff6e600136e48cc7622)), closes [#14](https://github.com/kendrick/unbranded-starter/issues/14)
* implement the documented --latest flag ([1133581](https://github.com/kendrick/unbranded-starter/commit/113358128a9a2947615b04d889684335b59da8f1)), closes [#3](https://github.com/kendrick/unbranded-starter/issues/3)
* initialize a git repo for new projects before hooks need it ([0c02ce8](https://github.com/kendrick/unbranded-starter/commit/0c02ce85b23cced041c5b2cc49ab03d497819735)), closes [#12](https://github.com/kendrick/unbranded-starter/issues/12)
* let inline flags drive a non-interactive run without a recipe file ([f955871](https://github.com/kendrick/unbranded-starter/commit/f955871a7d9441e5fd09269477b2202d6400e038)), closes [#16](https://github.com/kendrick/unbranded-starter/issues/16)
* lower the Node floor to 22 and fail with a clear message ([88f1ae3](https://github.com/kendrick/unbranded-starter/commit/88f1ae3f7abf45b077e24d12abe01ddb157c42e4)), closes [#5](https://github.com/kendrick/unbranded-starter/issues/5)


### Bug Fixes

* install in new-project mode by detecting the PM before it's needed ([47d002f](https://github.com/kendrick/unbranded-starter/commit/47d002f6c6ff41aba7999d2de89039ca49bf77ec)), closes [#2](https://github.com/kendrick/unbranded-starter/issues/2)
* **install:** run package-manager spawns through the shell on Windows ([4809cc9](https://github.com/kendrick/unbranded-starter/commit/4809cc9f447d0be66b8a9aa172eb95b067e7b079)), closes [#4](https://github.com/kendrick/unbranded-starter/issues/4)
* make every prompt cancel exit 130 instead of 0 ([e2a70fb](https://github.com/kendrick/unbranded-starter/commit/e2a70fbc8ffe2e3bb157dba4b90926097fca69a1)), closes [#8](https://github.com/kendrick/unbranded-starter/issues/8)

## [0.2.0](https://github.com/kendrick/unbranded-starter/compare/v0.1.0...v0.2.0) (2026-07-02)


### Features

* add `npm create unbranded` launcher ([9f6e966](https://github.com/kendrick/unbranded-starter/commit/9f6e96666853a3f1501aa587dcf4497d1910abe4))


### Bug Fixes

* **e2e:** keep the prepare hook out of pack snapshot stdout ([14cdf42](https://github.com/kendrick/unbranded-starter/commit/14cdf4231478d79a61e18f1839ba4263d2be8728))
* **eslint:** disable pnpm/yaml-enforce-settings to keep scaffolded lockfiles clean ([10777d7](https://github.com/kendrick/unbranded-starter/commit/10777d778ced649f53c746f9ea4a88a7c042b0e4))
