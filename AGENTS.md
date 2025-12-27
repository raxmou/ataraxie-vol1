# Agent Guide

## Overview
This project is a vanilla JS single-page map viewer. It renders a GeoJSON grid into an SVG, lets users click a state, and animates the viewBox to fit the left map pane while a right info pane shows details.

## File layout
- `index.html`: SPA layout and data source (`data-geojson`).
- `css/style.css`: layout, responsive split view, and map styling.
- `js/app.js`: entry point, UI state, selection logic, URL sync.
- `js/data.js`: GeoJSON loader.
- `js/geometry.js`: GeoJSON-to-path helpers.
- `js/map.js`: SVG renderer, state borders, hover highlight, bounds.
- `js/viewbox.js`: viewBox parsing/animation.
- `js/main.js`: compatibility shim that imports `js/app.js`.
- `state.html` + `js/state.js`: legacy and unused in the SPA.

## Data flow
1. `index.html` sets `data-geojson` on `#app`.
2. `js/app.js` calls `loadGeoJSON`, then `createMap` to render paths and compute bounds.
3. `createMap` builds state borders from shared edges and exposes `getStateBounds`.
4. Selecting a state updates `#app.is-split`, updates `?state=`, and animates the SVG viewBox.

## Conventions and DOM hooks
- IDs: `app`, `map-svg`, `info-pane`, `state-content`, `state-back`.
- State id comes from `feature.properties.state`; `"0"` is treated as ocean.
- Use `#app.is-split` as the only layout toggle.
- Respect `prefers-reduced-motion` in viewBox animation.
- Keep modules focused: small exports, minimal shared state.

## Styling rules
- CSS variables live in `:root`.
- The map pane is full width until `#app.is-split`.
- Info pane is hidden with `aria-hidden="true"` when not selected.

## Manual testing
1. Serve the folder (example: `python3 -m http.server`).
2. Open `index.html` and confirm the full map fills the screen.
3. Click a state: map zooms to left pane, info pane opens with count.
4. Click “Back to full map”: view resets and info pane closes.
5. Visit `?state=<id>` directly and confirm selection loads.
