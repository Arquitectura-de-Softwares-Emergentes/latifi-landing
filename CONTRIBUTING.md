# Contributing to latifi-landing

This repository follows GitFlow with Conventional Commits. Two checks, `ci` and `commit-lint`, must be green before a pull request merges.

## Branch model

- `main` holds releases only. Every commit on `main` is a release or a hotfix.
- `develop` is the integration branch. Day-to-day work lands here.
- `feature/*` branches start from `develop` and return to `develop` by squash merge.
- `release/*` branches start from `develop` and merge into `main` with a merge commit.
- `hotfix/*` branches start from `main` and merge into `main`, then back into `develop`.

## Branch naming

A branch name is `feature`, `release` or `hotfix`, a slash, and a lowercase slug. The slug may contain letters, digits, dots, underscores and hyphens.

Valid: `feature/loan-request-form`, `release/0.1.0`, `hotfix/1.0.1`.
Invalid: `fix/typo`, `Feature/Login`, `feature/UpperCase`.

The commit-lint check enforces this on every pull request:

- Into `develop`: the head branch must be `feature/*`, `release/*` or `hotfix/*`.
- Into `main`: the head branch must be `release/*` or `hotfix/*`.

## Pull request targets

| Branch type | Starts from | Opens a PR into | Merge method |
| ----------- | ----------- | --------------- | ------------ |
| `feature/*` | `develop`   | `develop`       | Squash       |
| `release/*` | `develop`   | `main`          | Merge commit |
| `hotfix/*`  | `main`      | `main`, then `develop` | Merge commit |

## Conventional Commits

Every commit subject and every pull request title follows this form:

```
type(scope): short description
```

The scope is optional and lowercase. An exclamation mark before the colon marks a breaking change. The subject stays within 100 characters.

Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.

Examples:

- `feat(loans): add the repayment schedule`
- `fix: reject a zero principal`
- `feat(api)!: remove the v1 endpoints`
- `docs: explain the release flow`

Squash merges reuse the pull request title as the commit subject, so the title must follow the same rules.

## Commit hygiene

Commits carry no AI co-author trailers and no generated-with lines. The commit-lint check rejects them. Human co-author trailers are fine.

## Required checks

| Check         | What it does                                                       |
| ------------- | ------------------------------------------------------------------ |
| `ci`          | Builds and tests the repository                                    |
| `commit-lint` | Validates commit subjects, the PR title, AI trailers and branch names |

Once branch protection is on, a pull request also needs one approving review.

## Versioning and tags

Releases use SemVer. Right after a release or hotfix merges into `main`, create an annotated tag named `vMAJOR.MINOR.PATCH` on `main`, for example `v0.1.0`. Stay on `0.y.z` until the first public release. When a release branch received fix commits, merge it back into `develop` so those fixes are not lost.

## Running the checks locally

The `ci` job validates every HTML file with the Nu HTML Checker, checks local links and fragments with lychee in offline mode, runs the language and accessibility guard and the CSP guard, and then runs the meta, parity, contrast, browser and Lighthouse checks. Before you push, run the same commands. The first four need only bash. The rest need Node 22 or newer and Google Chrome, plus `npm ci --ignore-scripts` once:

```
bash scripts/check-i18n-a11y.sh
bash scripts/check-i18n-a11y.test.sh
bash scripts/check-csp.sh
bash scripts/check-csp.test.sh
node scripts/check-meta.mjs --self-test
node scripts/check-meta.mjs --strict
node scripts/check-i18n-parity.mjs --self-test
node scripts/check-i18n-parity.mjs
node scripts/check-contrast.mjs
node scripts/ui-check.mjs
node scripts/lighthouse-check.mjs
```

The guard fails when a page loses its `lang` attribute, its skip link, its single `main` landmark, its title or its `hreflang` alternates. The CSP guard fails on a weakened policy, an inline script whose hash is missing, or any inline style or event handler. The Nu HTML Checker and lychee run only in CI.

Every push to `main` deploys the site to GitHub Pages through `.github/workflows/pages.yml`. Pull requests never deploy. The README explains how to change the site URL, the download link and the video.

To try the commit rules without GitHub, run `bash .github/scripts/commit-lint.test.sh`.

## Secrets

Never commit secrets. Private keys, RPC URLs with API keys, passwords and tokens belong in environment variables, a local `.env` file that git ignores, or the CI secret store. If a secret reaches a commit, rotate it right away.
