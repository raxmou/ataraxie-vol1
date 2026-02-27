# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Ataraxie Vol 1 - Interactive Map. A vanilla JavaScript SPA that renders GeoJSON hex grids with texture-based patchwork effect, character selection, fog of war mechanics, 3D visualization (Three.js), hourglass audio player with physics-based particles, and audio-reactive visuals. No build tools or package manager - all files served as-is.

## Development Commands

```bash
# Start local server
make
# or
python3 -m http.server 8003

# Lint & format
make lint
make format

# Deploy to Vercel
vercel
# or push to main branch for auto-deploy
```

## Architecture

### Directory Structure

```
js/
  main.js                         -- Entry point
  app.js                          -- Orchestrator (~740 lines)

  core/
    store.js                      -- Reactive state store + event bus
    constants.js                  -- Magic numbers, URLs, config
    dom-refs.js                   -- Cached DOM references
    utils.js                      -- formatTime, clamp, easing, noise

  data/
    data.js                       -- JSON loaders (geojson, tracks, sigils)
    fog.js                        -- Fog of war state + neighbor graph

  map/
    map.js                        -- SVG map rendering, state coloring
    map-gestures.js               -- Pinch/pan gestures
    geometry.js                   -- GeoJSON-to-SVG paths
    outline.js                    -- State boundary computation
    viewbox.js                    -- ViewBox animation
    texture-canvas.js             -- Canvas texture renderer
    sigils.js                     -- Sigil hover/focus rendering
    navigation.js                 -- (planned) selectState, clearSelection

  three/
    three-loader.js               -- Lazy CDN import + cache
    three-scene.js                -- Init, resize, render loop, dispose
    three-mesh.js                 -- buildStateMesh, geometry helpers
    three-morph.js                -- morphTo3D, morphFrom3D
    three-interaction.js          -- Pointer drag/rotate/raycast

  audio/
    audio-reactive.js             -- FFT-driven visuals, ambient breathing
    hourglass/
      hourglass-player.js         -- Player orchestrator (~590 lines)
      hourglass-3d.js             -- 3D overlay (LatheGeometry)
      hourglass-particles.js      -- Particle class + physics + rendering
      hourglass-gestures.js       -- Rotation, shake, snap detection
      hourglass-audio.js          -- Reverse playback, Web Audio bridge
      hourglass-constants.js      -- WIDTH, HEIGHT, colors, geometry

  ui/
    info-panel.js                 -- Narrative, track shrine, play flow
    question-modal.js             -- Tarot cards, handleAnswer, celebration
    character-select.js           -- Selection modal + fly animation
    character-map.js              -- Map character, trails, bark
    character-state.js            -- State character, drag, float, menu
    character-data.js             -- CHARACTER_MOVE_MAP, getCharacterFrame
    modals.js                     -- Layout toggles, loading, about modal
    info-pane-gesture.js          -- Swipe gesture

  i18n/
    i18n.js                       -- Translations (FR/EN)

  state.js                        -- Standalone state page viewer

css/
  style.css                       -- @import hub for all partials
  base.css                        -- Reset, fonts, :root variables
  layout.css                      -- App grid, split view, panes
  map.css                         -- Cells, borders, fog, textures
  characters.css                  -- Character select, avatar, cards
  modals.css                      -- About, loading, rotate overlay, mobile warning
  tarot.css                       -- Tarot card flip animations
  hourglass.css                   -- Hourglass player, shrine, narrative
  trails.css                      -- Trail lines, markers, characters
  responsive.css                  -- All @media queries
```

### Data Flow
1. `index.html` provides data URLs via `data-geojson`, `data-tracks`, `data-sigils` attributes on `#app`
2. `main.js` imports `app.js` which orchestrates the entire application
3. Character selection modal → Map loads → GeoJSON renders to canvas texture system + SVG overlay
4. User clicks state → fog of war question modal → state reveals → viewBox animation → info panel + audio
5. Hourglass player controls audio with rotation gestures and physics-based particle visualization

### Module Communication Pattern
Modules use a factory pattern with dependency injection to avoid circular imports:
```javascript
// Factory receives dependencies as callbacks/getters
export const createInfoPanel = ({
  getActiveStateId: () => activeStateId,
  onShowQuestionModal: (stateId) => questionMgr.showQuestionModal(stateId),
}) => { ... };
```
Cross-module mutable state is accessed via closure getters (e.g., `() => infoPanel?.hourglassPlayer`).

### Key State Variables (app.js)
```javascript
activeStateId              // Currently selected state ID (string)
geojsonData                // Loaded GeoJSON feature collection
stateCounts                // Map: stateId -> cell count
selectedCharacter          // "demon" | "succube" | "gargoyle"
mapApi                     // Map DOM API (from map.js)
textureCanvas              // Texture canvas API (from texture-canvas.js)
colorForState              // Function: stateId -> palette color
```

### Views
- **Map View**: Full map showing all states, trails, fog of war. No `is-split` class on `#app`.
- **State View**: Split layout — map on left, info pane (`#info-pane`) on right. Triggered by clicking a revealed state. Shows narrative text, hourglass player, question prompts, and the floating character avatar. `#app.is-split` is active.

### UI State Classes
- `#app.is-split` - State View active (map left, info pane right)
- `#app.is-3d`, `.is-3d-state` - 3D visualization states
- Cells: `.is-active`, `.is-ocean`, `.is-fogged`, `.is-hover`
- Modals: `[aria-hidden="true"]` / `[aria-hidden="false"]` for visibility

### Modal System
1. **Character Select** (`#character-select`): Choose demon/succube/gargoyle at start
2. **Question Modal** (`#question-modal`): Binary choice prompts for fog of war reveals
3. **Credits Modal** (`#credits-modal`): Shows on map completion, confetti effect, character change
4. **Loading Screen** (`#loading-screen`): Progress updates during asset loading

### SVG + Canvas Layers (z-index order, back to front)
1. **Texture canvas** (`.texture-canvas`) - State textures, borders, hover highlights
2. **SVG** (`#map-svg`) - Hex cells, borders, snapshot transitions
   - `#map-base` - Base cells
   - `#map-focus` - Selected state cells
   - `#map-snapshot` - Transition animation snapshot
   - `#map-sigils` - Hover sigil overlays
3. **3D Stack** (`#state-3d-stack`) - Canvas layers for Three.js
   - `#state-3d-canvas` - State mesh 3D view

## Conventions

### DOM Hooks
- Main: `#app`, `#map-svg`, `.map-pane`, `#info-pane`, `#state-content`, `#state-back`
- Modals: `#character-select`, `#question-modal`, `#credits-modal`, `#loading-screen`
- 3D: `#state-3d-canvas`
- Buttons: `#info-button`, `#character-confirm`, `#credits-close`, `#credits-change-character`
- Data attributes:
  - `data-geojson`, `data-tracks`, `data-sigils` (on `#app`) - Data file URLs
  - `data-state` (on cells) - State ID
  - `data-character` (on character cards) - Character type
- State ID from `feature.properties.state`; `"0"` is ocean (ignored in most logic)

### Styling
- CSS split into 9 domain partials, assembled via `@import` in `style.css`
- CSS variables in `:root` (colors, sizes, transitions)
- Map pane full width until `#app.is-split` triggers split layout
- Respect `prefers-reduced-motion` (disables particle physics, uses static hourglass fill)
- Texture files: `assets/textures/VISUALWORKS*.png` (6 textures, assigned by stateId % 6)
- Character SVGs: `assets/characters/{demon,succube,gargoyle}.svg`

### Three.js Integration
Loaded dynamically from CDN when 3D view activated:
```javascript
const THREE_URL = "https://unpkg.com/three@0.164.1/build/three.module.js"
const SVG_LOADER_URL = "https://unpkg.com/three@0.164.1/examples/jsm/loaders/SVGLoader.js?module"
```
Used for:
- State 3D mesh (extruded SVG paths with audio-reactive displacement)
- Hourglass 3D overlay (procedural LatheGeometry with glass/wire materials)

### Audio System
- Tracks: `data/tracks.json` - Array of `{id, title, artist, file, stateId, question, answers}`
- Audio element created per track, hourglass player attached
- Audio Context + Analyser for audio-reactive shader uniforms in 3D views
- Reverse playback: Web Audio API with reversed buffer (decoded in background)

### Fog of War Question System
- Questions stored in track metadata (`question`, `answers: [a, b]`)
- Binary choice modal appears when clicking unrevealed neighbor state
- Both answers reveal the target state (no wrong answers)
- State marked as `questionedStates` to avoid re-asking

## Manual Testing
1. Serve folder and open `index.html` → Character selection appears
2. Choose character → Loading screen → Full map appears with textures
3. Click state "1" (starting revealed state) → Split view, audio plays
4. Try hourglass rotation gestures (drag around edge) → Speed/direction changes
5. Click fogged neighbor → Question modal → Answer → State reveals with texture
6. Complete map (all states revealed) → Credits modal with confetti
7. Test `?state=<id>` URL parameter on state page
