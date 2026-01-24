# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Ataraxie Vol 1 - Interactive Map. A vanilla JavaScript SPA that renders GeoJSON hex grids into SVG with state selection, fog of war mechanics, 3D sigil visualization, and audio-reactive visuals. No build tools or package manager - all files served as-is.

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
1. `index.html` provides GeoJSON URL via `data-geojson` attribute on `#app`
2. `app.js` loads GeoJSON → creates map → builds neighbor graph
3. User clicks cell → state selection → viewBox animation → info panel render
4. Fog of war system reveals adjacent states via question prompts

### Module Responsibilities
- **app.js**: Main controller, state machine (activeStateId, 3D state, audio), UI orchestration
- **map.js**: SVG DOM manipulation, cell/border creation, bounds tracking, snapshot caching
- **fog.js**: Fog of war state management (revealedStates/questionedStates Sets)
- **viewbox.js**: SVG viewBox parsing and animation utilities
- **geometry.js**: GeoJSON-to-SVG path conversion
- **data.js**: Promise-based JSON loaders

### Key State Variables (app.js)
```javascript
activeStateId              // Currently selected state
geojsonData                // GeoJSON features
stateCounts                // Per-state cell count
revealedStates             // Set - fog of war revealed states
questionedStates           // Set - states that have shown questions
threeApi / sigilThreeApi   // Three.js instances (lazy-loaded)
```

### UI State Classes
- `#app.is-split` - Layout toggle for split view
- `#app.is-3d`, `.is-3d-state`, `.is-3d-sigil` - 3D visualization state
- Cells: `.is-active`, `.is-ocean`, `.is-fogged`, `.is-hover`

### SVG Layers
1. `#map-base` - cells + borders
2. `#map-focus` - currently selected state cells
3. `#map-snapshot` - animated transition snapshot
4. `#map-sigils` - hover sigil layer

## Conventions

### DOM Hooks
- IDs: `app`, `map-svg`, `info-pane`, `state-content`, `state-back`
- Data attributes: `data-geojson`, `data-tracks`, `data-sigils`, `data-state`, `data-action`
- State ID from `feature.properties.state`; `"0"` is ocean

### Styling
- CSS variables in `:root`
- Map pane full width until `#app.is-split`
- Respect `prefers-reduced-motion` for animations

### Three.js
Loaded dynamically from CDN when 3D view activated:
```javascript
const THREE_URL = "https://unpkg.com/three@0.164.1/build/three.module.js"
const SVG_LOADER_URL = "https://unpkg.com/three@0.164.1/examples/jsm/loaders/SVGLoader.js?module"
```

## Manual Testing
1. Serve folder and open `index.html`
2. Confirm full map fills screen
3. Click a state: map zooms to left pane, info pane opens
4. Click "Back to full map": view resets
5. Test `?state=<id>` URL parameter
