# ImongSpend Agent Brief

## Objective

Ship a clear landing page plus a Shopee-first Chrome extension MVP that answers one core question:

How much did I spend?

## Architecture Map

- `apps/landing`: public marketing site.
- `apps/extension`: Chrome extension source and manifest.
- `packages/shared`: shared spend types and provider contracts.

## Delivery Priorities

1. Landing clarity and conversion CTA.
2. Extension skeleton and shared contract stability.
3. Shopee ingestion path validation before live implementation.

## Non-Goals for MVP

- Full financial analytics dashboard.
- Cross-platform ingestion (Foodpanda and Grab) in first release.
- Production data sync before compliance review.

## Definition of Done

- Landing page runs and communicates product scope.
- Extension builds and loads as unpacked extension.
- Shared contracts compile and are consumed by extension UI.
- Lint, typecheck, and build pass from root scripts.