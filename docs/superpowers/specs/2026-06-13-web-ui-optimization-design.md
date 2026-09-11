# Web UI Comprehensive Optimization Design

## Problem

The current Web UI has critical CSS bugs (undefined custom properties) and visual shortcomings (cramped typography, flat dark mode, utilitarian styling).

## Approach

CSS-only changes across ~15 stylesheet files. No component logic changes.

## Changes

### 1. Design Token Completion (`theme.css`, `primitives.css`)
- Define missing variables: `--font-weight-normal/medium/semibold/bold`, `--leading-tight/normal/snug`, `--shadow-sm/md`, `--space-0-5`
- Fix broken `rgba(var(--panel-bg), 0.85)` → use `--chrome-bg` directly

### 2. Dark Mode Color Refinement (`theme.css`)
- 3-tier surface hierarchy: page (#0a1120) → panel (#161e2e) → elevated (#1e293b)
- Brighter text colors for better contrast
- Refined accent/glow values

### 3. Light Mode Polish (`theme.css`)
- Warmer page background
- Better shadow depth
- Improved surface layering

### 4. Component Visual Upgrades
- **Topbar** (`layout.css`): gradient brand, refined status pills
- **Phone Stage** (`phone-stage.css`): ambient radial glow, refined frame
- **Chat** (`chat-panel.css`, `chat-composer.css`): better bubble styling, refined composer
- **Agent Steps** (`agent-step-card.css`): refined accent bars, better badges
- **Config** (`config-panel.css`): better section headers, refined sticky header
- **Buttons** (`controls.css`): gradient primary, refined hover

### 5. Typography (`theme.css`)
- Apply font-weight variables
- Improved line-height scale
- Refined heading sizes

## Testing
- All existing tests pass (no logic changes)
- Visual verification via dev server
