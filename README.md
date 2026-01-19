# Ataraxie Vol 1 - Interactive Map

A vanilla JavaScript single-page map viewer that renders GeoJSON grids with interactive state selection and animations.

## Local Development

```bash
make
# or
python3 -m http.server 8003
```

Then open http://localhost:8003

## Deployment

This app is deployed on Vercel. To deploy updates:

### Via Vercel CLI
```bash
npm i -g vercel
vercel
```

### Via GitHub
Push to the main branch and Vercel will auto-deploy.

## Project Structure

- `index.html` - SPA entry point
- `css/style.css` - Layout and styling
- `js/` - All JavaScript modules
  - `app.js` - Main application logic
  - `map.js` - SVG rendering
  - `data.js` - GeoJSON loader
  - `geometry.js` - GeoJSON helpers
  - `viewbox.js` - Animation logic
- `assets/` - Fonts, music, backgrounds, sigils
- `data/` - JSON configuration files
- `*.geojson` - Map data files
