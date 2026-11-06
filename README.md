# Infrastructure Priority Map

A public map that answers one question: **what in this city most needs to be worked on next?**

It combines public data on crashes, emergency calls, service complaints, infrastructure
condition, weather and neighborhood vulnerability into one ranked list of problem spots,
each with the reasons behind its score.

First region: **Seattle, WA**. The design keeps the scoring engine separate from the
data sources so other Washington cities, the whole state, and later other states can be
added by plugging in new sources.

## Three questions the site answers
1. **What needs work next?** A ranked map of problem spots with the reasons for each score.
2. **Why is this being worked on?** Every current and future project, its cost, and the
   evidence of need behind it (or the lack of it).
3. **What's being ignored?** High-need spots with no funded project, and how spending per
   area compares with need per area.

## Principles
- **Fixes, not policing.** Focus on call types with a fixable cause (crashes, medical,
  fire, infrastructure). Leave out crime-type calls. Never single out people or exact homes.
- **Show the reasons.** Every ranked item explains why it ranks where it does.
- **Respect planned work.** Problems already in a funded capital plan are marked as
  scheduled, not ranked as neglected.
- **Check against reality.** Validate rankings against known Seattle problems
  (e.g. West Seattle Bridge, Magnolia Bridge, SDOT high-injury streets) and SDOT's
  Asset Status & Condition Report (published every 5 years; latest data 2020, next expected 2026).
- **Borrow SDOT's own criteria.** SDOT ranks paving by condition, traffic volume, equity,
  cost and coordination, and sidewalks by mobility impact, risk, cost, usage and equity.

## Priority score (draft)
`condition x usage x consequence of failure x area vulnerability`, reduced when repair
work is already scheduled.

## Status
Planning. See [docs/data-sources.md](docs/data-sources.md) for the data inventory.
