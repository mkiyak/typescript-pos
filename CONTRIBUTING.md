# Contributing

Thanks for helping out! Development requires Node.js 22 or newer. Before opening a pull request, run:

```sh
npm install
npm run check   # lint + typecheck + test + build + package lint (publint, attw)
```

## Commits

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) and are enforced by
commitlint through a husky `commit-msg` hook. Use English, imperative mood, and one of the scopes
`core`, `asseco`, `payflex`, `factory`, `docs`, `build`, `ci`, `release`, for example
`feat(asseco): add 3D hash crypt`.

## Changesets

Every user-facing change adds a changeset (`npm run changeset`): `minor` for features, `patch` for fixes.

## Versioning

SemVer. Before 1.0, breaking changes bump the minor version and everything else bumps the patch version.
Releases are tagged `vX.Y.Z`; the release commit is `chore(release): vX.Y.Z`. `VERSION` in `src/index.ts`
is maintained by hand and must equal `package.json`'s `version` (a unit test enforces this).

## Adding a gateway

1. One class per file, named after the class (`src/crypt/AssecoPosCrypt.ts`); directories are lowercase-kebab.
2. Put tests in `tests/unit/`, mirroring the `src/` layout; cover the bank's documented request and response
   samples and every security check.
3. Keep order input keys and normalized response keys identical to the existing gateways (snake_case).
4. Compare hashes with `timingSafeEqualStr()` and pass logger data through `maskSensitiveData()`.
5. Add a changeset and make sure `npm run check` passes.
