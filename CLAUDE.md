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

# Deploy to Vercel
vercel
# or push to main branch for auto-deploy
```

## Architecture

### Data Flow
1. `index.html` provides data URLs via `data-geojson`, `data-tracks`, `data-sigils` attributes on `#app`
2. `main.js` imports `app.js` which orchestrates the entire application
3. Character selection modal → Map loads → GeoJSON renders to canvas texture system + SVG overlay
4. User clicks state → fog of war question modal → state reveals → viewBox animation → info panel + audio
5. Hourglass player controls audio with rotation gestures and physics-based particle visualization

### Module Responsibilities
- **app.js** (2912 lines): Main controller, state machine, UI orchestration
  - Manages: activeStateId, audio playback, 3D state, fog of war, modals, texture canvas
  - Handles: user interactions, state transitions, question prompts, character selection
- **main.js**: Entry point (imports app.js)
- **map.js**: SVG DOM manipulation, cell/border rendering, snapshot caching for transitions
- **fog.js**: Fog of war state (revealedStates/questionedStates Sets, neighbor graph, exploration trails)
- **viewbox.js**: SVG viewBox parsing, animation utilities (easing, interpolation)
- **geometry.js**: GeoJSON-to-SVG path conversion (Polygon/MultiPolygon support)
- **data.js**: Promise-based JSON loaders with type-specific caching
- **texture-canvas.js**: Canvas-based texture renderer synced with SVG viewBox
  - Renders state-specific textures clipped to state outlines
  - Adaptive tile sizing based on zoom level
  - Hover state highlighting
- **outline.js**: State boundary computation from hex cell edges
  - Extracts exterior edges (count === 1) per state
  - Chains edges into closed rings for Path2D clipping
- **hourglass-player.js** (1580 lines): Physics-based audio player
  - Rotation gestures control playback speed/direction (-2x to 2x)
  - Shake gesture detection for 2x boost
  - Reverse playback via Web Audio API
  - Particle physics (gravity, collision, settling) with 1 particle per second
  - 3D Three.js hourglass overlay (LatheGeometry with glass/wire/rim materials)
  - Vertical scrubbing for seek
- **state.js**: Standalone state page viewer (for `?state=<id>` URLs)
  - Rehydrates shared overlay from sessionStorage for seamless transitions

### Key State Variables (app.js)
```javascript
// Core state
activeStateId              // Currently selected state ID (string)
geojsonData                // Loaded GeoJSON feature collection
stateCounts                // Map: stateId -> cell count
selectedCharacter          // "demon" | "succube" | "gargoyle"

// Fog of war (imported from fog.js)
revealedStates             // Set<stateId> - discovered states
questionedStates           // Set<stateId> - states that showed questions
explorationTrails          // Array<{from, to}> - discovery paths
explorationOrder           // Array<stateId> - discovery sequence

// Audio & player
activeAudio                // HTMLAudioElement - current track
hourglassPlayer            // Hourglass player API instance
trackByState               // Map: stateId -> track metadata
trackById                  // Map: trackId -> track metadata

// 3D rendering
threeApi                   // Three.js state 3D renderer (lazy-loaded)
sigilThreeApi              // Three.js sigil 3D renderer (lazy-loaded)
audioContext/audioAnalyser // Web Audio API for reactive visuals

// Rendering
mapApi                     // Map DOM API (from map.js)
textureCanvas              // Texture canvas API (from texture-canvas.js)
colorForState              // Function: stateId -> HSL color
sigilsByState              // Map: stateId -> sigil SVG path
```

### Views
- **Map View**: Full map showing all states, trails, fog of war. No `is-split` class on `#app`.
- **State View**: Split layout — map on left, info pane (`#info-pane`) on right. Triggered by clicking a revealed state. Shows narrative text, hourglass player, question prompts, and the floating character avatar. `#app.is-split` is active.

### UI State Classes
- `#app.is-split` - State View active (map left, info pane right)
- `#app.is-3d`, `.is-3d-state`, `.is-3d-sigil` - 3D visualization states
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
   - `#sigil-3d-canvas` - Sigil mesh 3D view

## Conventions

### DOM Hooks
- Main: `#app`, `#map-svg`, `.map-pane`, `#info-pane`, `#state-content`, `#state-back`
- Modals: `#character-select`, `#question-modal`, `#credits-modal`, `#loading-screen`
- 3D: `#state-3d-canvas`, `#sigil-3d-canvas`, `#three-toggle`
- Buttons: `#info-button`, `#character-confirm`, `#credits-close`, `#credits-change-character`
- Data attributes:
  - `data-geojson`, `data-tracks`, `data-sigils` (on `#app`) - Data file URLs
  - `data-state` (on cells) - State ID
  - `data-character` (on character cards) - Character type
  - `data-3d-target` (on toggle buttons) - "state" or "sigil"
- State ID from `feature.properties.state`; `"0"` is ocean (ignored in most logic)

### Styling
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
- Sigil 3D mesh (extruded sigil SVG with rotation/animation)
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
