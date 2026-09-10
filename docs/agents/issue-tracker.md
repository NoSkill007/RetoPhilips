# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a body file for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, including labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments` with appropriate label and state filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`.
- **Apply or remove labels**: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`.
- **Close**: `gh issue close <number> --comment "..."`.

Infer the repository from `git remote -v`; `gh` does this automatically when run inside the clone.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## When a skill says publish to the issue tracker

Create a GitHub issue.

## When a skill says fetch the relevant ticket

Run `gh issue view <number> --comments`.

## Wayfinding operations

- A wayfinding map is a GitHub issue labelled `wayfinder:map`.
- Child tickets use GitHub sub-issues when available and otherwise link back to the map in their bodies.
- Blocking relationships use GitHub issue dependencies when available and otherwise a `Blocked by` line.
- Claim work by assigning the issue to the current GitHub user.
- Resolve work by documenting the answer, closing the issue and linking the result from the map.
