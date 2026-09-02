# MyDraw 🎨

A pure HTML5/CSS/JavaScript web application for realistic, physical subtractive color mixing in the browser. Unlike standard digital RGB blending (which mixes blue and yellow into grey), MyDraw uses Kubelka-Munk spectral reflectance theory via [Spectral.js](https://github.com/rvanwijnen/spectral.js) to mix blue and yellow into vibrant, natural green — just like real paint!

---

## ✨ Features

- **Realistic Subtractive Mixing**: Spectral Kubelka-Munk color model producing real-world pigment blending (Blue + Yellow = Green, Red + Blue = Purple).
- **Smooth Pointer & Touch Drawing**: High-frequency continuous strokes using `PointerEvent.getCoalescedEvents()` and sub-pixel distance interpolation.
- **Floating Glassmorphic Toolbar**: Modern, mobile-responsive UI with 12 artist-friendly circular color swatches (White, Yellow, Orange, Red, Pink, Purple, Blue, Cyan, Green, Lime, Brown, Black), dynamic active ring, brush size slider, and instant canvas clearing.
- **Zero Dependencies / No npm**: Pure static web application designed to run natively in any modern browser or host effortlessly on GitHub Pages.
- **Functional Core / Imperative Shell Architecture**: Clean separation between pure mathematical algorithms and DOM/Canvas I/O.

---

## 🏛 Architecture

MyDraw is built using the **Functional Core, Imperative Shell** architectural pattern:

```
colorfusion/
├── vendor/
│   └── spectral.js          # Kubelka-Munk color theory library
├── js/
│   ├── color-bridge.js      # [Core] Pure adapter for spectral mixing & hex/rgb conversions
│   ├── geometry.js          # [Core] Pure functions for Euclidean distance & stroke interpolation
│   ├── drawing-engine.js    # [Shell] Canvas pixel manipulation & stroke rendering
│   └── app.js               # [Shell] Pointer events, DOM listeners & toolbar state
├── css/
│   └── style.css            # Responsive layout, touch-action, glassmorphism toolbar
├── tests/
│   ├── test-framework.js    # Minimal in-browser BDD test library
│   ├── test-runner.html     # Visual browser test suite runner
│   ├── color-bridge.test.js # Unit tests for color-bridge
│   ├── geometry.test.js     # Unit tests for geometry
│   └── run-tests.py         # Headless CLI test runner
├── index.html               # Webapp entrypoint
├── Makefile                 # Automation targets (serve, test)
└── .nojekyll                # GitHub Pages asset support
```

### Functional Core (Pure & Tested)
- **`js/color-bridge.js`**: `rgbToHex`, `hexToRgb`, `mixPixelColors`
- **`js/geometry.js`**: `distance`, `interpolatePoints`

### Imperative Shell (I/O & Canvas)
- **`js/drawing-engine.js`**: Canvas context management, bounding box pixel reading/writing (`getImageData`/`putImageData`), dot stamping, and stroke rasterization.
- **`js/app.js`**: Viewport resizing with buffer preservation, pointer capture, coalesced input dispatch, and UI control bindings.

---

## 🚀 Getting Started

### Local Development

To start a local development server on port 8000:

```bash
make serve
```

Or using Python directly:

```bash
python3 -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000) in your web browser.

---

## 🧪 Testing

MyDraw uses an in-browser test framework with Red-Green TDD coverage for all functional core modules.

### Run in Browser
Open `tests/test-runner.html` in any modern web browser or navigate to `http://localhost:8000/tests/test-runner.html`.

### Run via Command Line
Run the automated headless test runner:

```bash
make test
```

---

## 📄 License

MIT License. See [LICENSE](LICENSE) or source headers for details.
