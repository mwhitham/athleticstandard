# Contributing

Use a feature branch and open a pull request against `main`. Keep each commit to one logical change.

## Protect health data

Never commit a real health export or athlete file. This rule applies to public and private repositories because clones, logs, and old commits retain deleted data.

Keep real validation data in encrypted storage outside Git. Public bug reports, tests, and decisions must use the smallest invented example that proves the behavior. Remove exact workout dates, locations, birth dates, travel clues, device inventories, and sample values.

Files under `tests/fixtures/exports/` are synthetic. Adding one requires an explicit entry in the allowlist in `scripts/check-public-data.ts` and `.gitignore`. The generated demo athlete is the only approved `.ath.json` file.

Do not upload real exports to public continuous integration. Run private validation locally and publish only a sanitized conclusion.

## Verify a change

Run:

```sh
pnpm check:public-data
pnpm typecheck
pnpm test
pnpm build
```
