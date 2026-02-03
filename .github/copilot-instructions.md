# FightPicks Codebase Guide for AI Agents

## Overview
FightPicks is a Next.js web app for users to make predictions on MMA fights and compete on leaderboards. Built with React 19, TypeScript, Supabase (auth + database), and Tailwind CSS.

## Architecture

### Core Stack
- **Framework**: Next.js 16 (App Router, `'use client'` single-page app)
- **Database**: Supabase (auth + PostgreSQL tables)
- **Auth**: Supabase built-in email/password authentication with session management
- **Styling**: Tailwind CSS v4 + inline styles (no component library)
- **Compiler**: React Compiler enabled (`reactCompiler: true`)

### Key Data Model
- **Events** (`events` table): MMA events with `id`, `name`, `event_date`
- **Fights** (`fights` table): Individual fights belonging to events; fields: `id`, `event_id`, `fighter_red`, `fighter_blue`, `fight_time`
- **Picks** (`picks` table): User predictions; fields: `fight_id`, `user_id`, `winner` (red|blue), `round` (1-5, nullable), `finish_type`, `confidence` (1-10), `locked` (boolean)
- **Profiles** (`profiles` table): User metadata; fields: `id`, `username` (unique, validated 3-20 chars alphanumeric + underscore)
- **Event Leaderboards** (`event_leaderboard` view/table): Aggregated scores per event; includes `total_score`, `scored_picks`, `perfect_picks`, `total_confidence_used`

### Data Flow
1. **Load Phase**: On app mount, fetch all events + fights (combined client-side into `EventWithFights` structure)
2. **Auth Phase**: Listen for session changes; when user logs in, fetch their profile + picks
3. **Leaderboards Phase**: For each event, fetch per-event leaderboard independently
4. **Save Phase**: User locks/unlocks picks (upsert to DB with `onConflict` handling)

## Key Patterns & Conventions

### Pick State Management
- Picks stored as `Record<string, Pick>` where key = `fight_id`
- **Unlocked picks** live only in client state (not saved to DB until locked)
- **Locked picks** are persisted to `picks` table with `locked: true`
- All confidence values clamped to 1-10 via `clampConfidence(n)`
- Rounds ignored for decision/no-contest finishes via `isRoundIrrelevant()`

### Form Validation
- Username: `/^[a-zA-Z0-9_]{3,20}$/` (enforced on both save attempts and DB uniqueness constraint)
- Duplicate username errors caught by code checking for `error.code === '23505'` (PostgreSQL unique violation)

### Fight Start Logic
- Fight times compared against `Date.now()` to detect if started
- Once started: inputs disabled, opacity reduced to 0.6, picks immutable
- Server-side validation in Supabase ensures picks locked before fight start

### Leaderboard Query Strategy
- **NOT** a single leaderboard per user; instead **per-event leaderboards**
- Each event fetched separately to `leaderboards[event.id]`
- Current user rank calculated by finding their index in the event's leaderboard array

### UI Styling Approach
- Inline styles only (no class-based Tailwind in app/page.tsx)
- Color scheme: red (#dc2626, #b91c1c), blue (#2563eb, #1d4ed8), green (#4ade80), yellow (#fde68a), gray (#f0f2f5 bg)
- Cards use `boxShadow: '0 8px 20px rgba(0,0,0,0.12)'`, rounded corners 12-16px

### Error Handling
- Supabase errors logged to console + shown to user via `alert()`
- Network failures degrade gracefully (leaderboard fetch errors loop-continue)
- Optimistic UI updates: lock/unlock toggled immediately, reverted on DB error

## Development Workflow

### Setup
```bash
npm install
npm run dev  # Starts on http://localhost:3000
```

### Build
```bash
npm run build
npm start    # Production server
```

### Environment Variables
Required in `.env.local`:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Both must be public (NEXT_PUBLIC prefix) since this is a client-side Supabase auth flow.

### Key Files
- [app/page.tsx](app/page.tsx) — Single monolithic component (~800 lines): Auth, picks UI, leaderboards
- [lib/supabase.ts](lib/supabase.ts) — Supabase client initialization
- [app/layout.tsx](app/layout.tsx) — Root layout with fonts & metadata
- [app/globals.css](app/globals.css) — Global Tailwind styles

## Common Tasks

### Adding a New Field to Picks
1. Update `Pick` type in app/page.tsx
2. Update Supabase `picks` table schema
3. Adjust pick fetch/upsert logic to handle new field
4. Update lock/unlock toggle to include the field

### Modifying Leaderboard Aggregation
- Edit the `event_leaderboard` view in Supabase (not application code)
- Or adjust the fetch query in `useEffect` for leaderboards if adding client-side sorting

### Extending Auth
- User onboarding (username prompt) already at signup — keep in sync with profile creation
- Session persistence handled by Supabase SDK automatically

## Testing Notes
- No automated tests currently; manual browser testing recommended
- Test fight start time boundary: edit fight_time in DB and verify picks lock/UI disables
- Test username uniqueness: attempt duplicate usernames and confirm 23505 error handling

## Known Patterns to Preserve
- Single-page architecture (no route segments; all logic in page.tsx)
- Client-side data normalization (events + fights combined into EventWithFights)
- Optimistic UI updates with error rollback for mutations
- No external API calls outside Supabase
