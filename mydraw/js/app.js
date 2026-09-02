/**
 * App - UI wiring and pointer interaction shell for MyDraw.
 */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('paint-canvas');
    if (!canvas) {
      console.error('Canvas element #paint-canvas not found');
      return;
    }

    const engine = createDrawingEngine(canvas);

    const GALLERY_STORAGE_KEY = 'colorfusion-gallery';
    const MAX_GALLERY_ITEMS = 20;

    // UI elements
    const swatches = document.querySelectorAll('.swatch');
    const brushSizeInput = document.getElementById('brush-size');
    const brushSizeDisplay = document.getElementById('brush-size-display');
    const eraserBtn = document.getElementById('btn-eraser');
    const zoomOutBtn = document.getElementById('btn-zoom-out');
    const zoomInBtn = document.getElementById('btn-zoom-in');
    const zoomDisplay = document.getElementById('zoom-level-display');
    const canvasWrapper = document.getElementById('canvas-wrapper');
    const saveFileBtn = document.getElementById('btn-save-file');
    const newBtn = document.getElementById('btn-new');
    const galleryBtn = document.getElementById('btn-gallery');

    const modalNew = document.getElementById('modal-new-drawing');
    const modalCancelBtn = document.getElementById('btn-modal-cancel');
    const modalConfirmBtn = document.getElementById('btn-modal-confirm');
    const galleryPanel = document.getElementById('gallery-panel');
    const galleryBackdrop = document.getElementById('gallery-backdrop');
    const galleryCloseBtn = document.getElementById('btn-gallery-close');
    const galleryGrid = document.getElementById('gallery-grid');
    const galleryEmpty = document.getElementById('gallery-empty');

    // Zoom state (100%, 75%, 50%, 25%)
    const ZOOM_LEVELS = [0.25, 0.5, 0.75, 1.0];
    let zoomIndex = 3; // Default: 100%

    // Drawing state
    let isDrawing = false;
    let isEraserActive = false;
    let lastX = 0;
    let lastY = 0;

    // Ensure first/active swatch is highlighted and initialize default color
    const initialActive = document.querySelector('.swatch.active') || swatches[0];
    if (initialActive && !initialActive.classList.contains('active')) {
      initialActive.classList.add('active');
    }
    let currentColor = initialActive ? (initialActive.getAttribute('data-color') || '#FFFFFF') : '#FFFFFF';
    let currentSize = 20;         // Default: 20px

    // Set default canvas size (framed workspace)
    if (!canvas.width || canvas.width === 300) {
      canvas.width = 1024;
    }
    if (!canvas.height || canvas.height === 150) {
      canvas.height = 768;
    }

    /**
     * Map client pointer coordinates to canvas space.
     * @param {PointerEvent|MouseEvent} event
     * @returns {{x: number, y: number}}
     */
    function getCanvasCoords(event) {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / (rect.width || 1);
      const scaleY = canvas.height / (rect.height || 1);
      return {
        x: (event.clientX - rect.left) * scaleX,
        y: (event.clientY - rect.top) * scaleY,
      };
    }

    // Pointer Event Handlers
    canvas.addEventListener('pointerdown', (e) => {
      // For mouse input, only proceed on primary button
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();

      try {
        canvas.setPointerCapture(e.pointerId);
      } catch (_) {}

      isDrawing = true;
      const coords = getCanvasCoords(e);
      lastX = coords.x;
      lastY = coords.y;

      if (isEraserActive) {
        engine.eraseDot(lastX, lastY, currentSize);
      } else {
        engine.drawDot(lastX, lastY, currentColor, currentSize, 0.3);
      }
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!isDrawing) return;
      e.preventDefault();

      // Use getCoalescedEvents if available for smoother high-frequency strokes
      const events = (typeof e.getCoalescedEvents === 'function' && e.getCoalescedEvents().length > 0)
        ? e.getCoalescedEvents()
        : [e];

      for (let i = 0; i < events.length; i++) {
        const coords = getCanvasCoords(events[i]);
        if (isEraserActive) {
          engine.eraseStroke(lastX, lastY, coords.x, coords.y, currentSize);
        } else {
          engine.drawStroke(lastX, lastY, coords.x, coords.y, currentColor, currentSize, 0.3);
        }
        lastX = coords.x;
        lastY = coords.y;
      }
    });

    function stopDrawing(e) {
      if (!isDrawing) return;
      isDrawing = false;
      try {
        if (canvas.hasPointerCapture && canvas.hasPointerCapture(e.pointerId)) {
          canvas.releasePointerCapture(e.pointerId);
        }
      } catch (_) {}
    }

    canvas.addEventListener('pointerup', stopDrawing);
    canvas.addEventListener('pointercancel', stopDrawing);
    canvas.addEventListener('pointerleave', (e) => {
      // If pointer is captured, pointerup handles it. If not captured, stop drawing.
      if (!canvas.hasPointerCapture || !canvas.hasPointerCapture(e.pointerId)) {
        stopDrawing(e);
      }
    });

    /**
     * Toggle or set eraser tool state.
     * @param {boolean} [forceState]
     */
    function setEraserState(forceState) {
      isEraserActive = typeof forceState === 'boolean' ? forceState : !isEraserActive;
      if (eraserBtn) {
        eraserBtn.classList.toggle('active', isEraserActive);
        eraserBtn.setAttribute('aria-pressed', isEraserActive ? 'true' : 'false');
      }

      if (isEraserActive) {
        swatches.forEach((s) => s.classList.remove('active'));
      } else {
        // Re-highlight the selected color swatch
        swatches.forEach((s) => {
          if (s.getAttribute('data-color') === currentColor) {
            s.classList.add('active');
          }
        });
      }
    }

    if (eraserBtn) {
      eraserBtn.addEventListener('click', () => {
        setEraserState();
      });
    }

    /**
     * Apply the current zoom level to the canvas wrapper and update UI.
     */
    function applyZoom() {
      const scale = ZOOM_LEVELS[zoomIndex];
      if (canvasWrapper) {
        canvasWrapper.style.transform = `scale(${scale})`;
        canvasWrapper.style.transformOrigin = 'center center';
      }
      if (zoomDisplay) {
        zoomDisplay.textContent = `${Math.round(scale * 100)}%`;
      }
      if (zoomOutBtn) {
        zoomOutBtn.disabled = (zoomIndex === 0);
      }
      if (zoomInBtn) {
        zoomInBtn.disabled = (zoomIndex === ZOOM_LEVELS.length - 1);
      }
    }

    if (zoomOutBtn) {
      zoomOutBtn.addEventListener('click', () => {
        if (zoomIndex > 0) {
          zoomIndex--;
          applyZoom();
        }
      });
    }

    if (zoomInBtn) {
      zoomInBtn.addEventListener('click', () => {
        if (zoomIndex < ZOOM_LEVELS.length - 1) {
          zoomIndex++;
          applyZoom();
        }
      });
    }

    applyZoom();

    // Toolbar - Swatch Selection
    swatches.forEach((swatch) => {
      swatch.addEventListener('click', () => {
        if (isEraserActive) {
          setEraserState(false);
        }
        swatches.forEach((s) => s.classList.remove('active'));
        swatch.classList.add('active');
        currentColor = swatch.getAttribute('data-color') || '#FFFFFF';
      });
    });

    // Toolbar - Brush Size Slider
    if (brushSizeInput && brushSizeDisplay) {
      brushSizeInput.addEventListener('input', (e) => {
        currentSize = parseInt(e.target.value, 10) || 20;
        brushSizeDisplay.textContent = `${currentSize}px`;
      });
    }



    /**
     * Download current canvas drawing to a PNG file with formatted timestamp.
     */
    function saveToPngFile() {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const yyyy = now.getFullYear();
      const mm = pad(now.getMonth() + 1);
      const dd = pad(now.getDate());
      const hh = pad(now.getHours());
      const min = pad(now.getMinutes());
      const ss = pad(now.getSeconds());
      const filename = `mydraw-${yyyy}-${mm}-${dd}-${hh}${min}${ss}.png`;

      canvas.toBlob(function (blob) {
        if (!blob) return;

        // Try Web Share API first (Safari iOS → share sheet → Save Image)
        const canShare = typeof navigator.share === 'function' && typeof navigator.canShare === 'function';
        if (canShare) {
          const file = new File([blob], filename, { type: 'image/png' });
          const shareData = { files: [file] };
          if (navigator.canShare(shareData)) {
            navigator.share(shareData).catch(function () {
              // User cancelled — fine
            });
            return;
          }
        }

        // Fallback: anchor download (Firefox iOS → Downloads, Desktop → download)
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = filename;
        link.href = url;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }, 'image/png');
    }

    if (saveFileBtn) {
      saveFileBtn.addEventListener('click', saveToPngFile);
    }

    /**
     * Retrieve stored gallery items from localStorage.
     * @returns {Array<{id: string, timestamp: number, dataUrl: string}>}
     */
    function getGallery() {
      try {
        const raw = localStorage.getItem(GALLERY_STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
      } catch (err) {
        console.warn('Could not read gallery from localStorage:', err);
        return [];
      }
    }

    /**
     * Save gallery items array to localStorage.
     * @param {Array<{id: string, timestamp: number, dataUrl: string}>} items
     * @returns {boolean}
     */
    function saveGallery(items) {
      try {
        localStorage.setItem(GALLERY_STORAGE_KEY, JSON.stringify(items));
        return true;
      } catch (err) {
        console.warn('Could not write gallery to localStorage:', err);
        if (items.length > 1) {
          items.pop();
          return saveGallery(items);
        }
        return false;
      }
    }

    /**
     * Save current canvas drawing to localStorage.
     */
    function saveCurrentDrawing() {
      try {
        const dataUrl = canvas.toDataURL('image/png');
        const now = Date.now();
        const newDrawing = {
          id: 'cf_' + now + '_' + Math.random().toString(36).substring(2, 7),
          timestamp: now,
          dataUrl: dataUrl,
        };
        const gallery = getGallery();
        gallery.unshift(newDrawing);
        if (gallery.length > MAX_GALLERY_ITEMS) {
          gallery.length = MAX_GALLERY_ITEMS;
        }
        saveGallery(gallery);
      } catch (err) {
        console.error('Failed to save current drawing:', err);
      }
    }

    /**
     * Show New Drawing confirmation modal.
     */
    function openNewModal() {
      if (!modalNew) return;
      modalNew.removeAttribute('hidden');
      modalNew.setAttribute('aria-hidden', 'false');
      requestAnimationFrame(() => {
        modalNew.classList.add('is-open');
      });
    }

    /**
     * Hide New Drawing confirmation modal.
     */
    function closeNewModal() {
      if (!modalNew) return;
      modalNew.classList.remove('is-open');
      modalNew.setAttribute('aria-hidden', 'true');
      setTimeout(() => {
        if (!modalNew.classList.contains('is-open')) {
          modalNew.setAttribute('hidden', '');
        }
      }, 200);
    }

    if (newBtn) {
      newBtn.addEventListener('click', openNewModal);
    }

    if (modalCancelBtn) {
      modalCancelBtn.addEventListener('click', closeNewModal);
    }

    if (modalConfirmBtn) {
      modalConfirmBtn.addEventListener('click', () => {
        closeNewModal();
        saveCurrentDrawing();
        engine.clear();
      });
    }

    if (modalNew) {
      modalNew.addEventListener('click', (e) => {
        if (e.target === modalNew) {
          closeNewModal();
        }
      });
    }

    /**
     * Format unix timestamp for thumbnail badge.
     * @param {number} timestamp
     * @returns {string}
     */
    function formatTimestamp(timestamp) {
      const date = new Date(timestamp);
      if (isNaN(date.getTime())) return '';
      return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      }) + ', ' + date.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      });
    }

    /**
     * Load an image onto the canvas.
     * @param {string} dataUrl
     */
    function loadDrawingOntoCanvas(dataUrl) {
      const img = new Image();
      img.onload = () => {
        engine.clear();
        const ctx = engine.getContext();
        ctx.drawImage(img, 0, 0);
      };
      img.src = dataUrl;
    }

    /**
     * Delete drawing by ID and refresh gallery view.
     * @param {string} id
     */
    function deleteDrawing(id) {
      let gallery = getGallery();
      gallery = gallery.filter((item) => item.id !== id);
      saveGallery(gallery);
      renderGallery();
    }

    /**
     * Render the saved drawings gallery.
     */
    function renderGallery() {
      if (!galleryGrid || !galleryEmpty) return;

      while (galleryGrid.firstChild) {
        galleryGrid.removeChild(galleryGrid.firstChild);
      }

      const gallery = getGallery();

      if (gallery.length === 0) {
        galleryEmpty.removeAttribute('hidden');
        return;
      }

      galleryEmpty.setAttribute('hidden', '');

      gallery.forEach((item) => {
        const card = document.createElement('div');
        card.className = 'gallery-card';
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');

        const formattedDate = formatTimestamp(item.timestamp);
        card.setAttribute('aria-label', `Load drawing from ${formattedDate}`);

        const thumbContainer = document.createElement('div');
        thumbContainer.className = 'gallery-thumb-container';

        const img = document.createElement('img');
        img.src = item.dataUrl;
        img.alt = `Drawing from ${formattedDate}`;
        img.className = 'gallery-thumbnail';
        thumbContainer.appendChild(img);

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'gallery-delete-btn';
        deleteBtn.setAttribute('aria-label', 'Delete drawing');
        deleteBtn.setAttribute('title', 'Delete drawing');
        deleteBtn.textContent = '×';
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteDrawing(item.id);
        });

        const info = document.createElement('div');
        info.className = 'gallery-info';
        info.textContent = formattedDate;

        card.appendChild(thumbContainer);
        card.appendChild(deleteBtn);
        card.appendChild(info);

        card.addEventListener('click', () => {
          loadDrawingOntoCanvas(item.dataUrl);
          closeGallery();
        });

        card.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            loadDrawingOntoCanvas(item.dataUrl);
            closeGallery();
          }
        });

        galleryGrid.appendChild(card);
      });
    }

    /**
     * Open the saved drawings gallery panel.
     */
    function openGallery() {
      if (!galleryPanel || !galleryBackdrop) return;
      renderGallery();
      galleryBackdrop.removeAttribute('hidden');
      galleryBackdrop.setAttribute('aria-hidden', 'false');
      galleryPanel.setAttribute('aria-hidden', 'false');
      requestAnimationFrame(() => {
        galleryBackdrop.classList.add('is-open');
        galleryPanel.classList.add('is-open');
      });
    }

    /**
     * Close the saved drawings gallery panel.
     */
    function closeGallery() {
      if (!galleryPanel || !galleryBackdrop) return;
      galleryBackdrop.classList.remove('is-open');
      galleryPanel.classList.remove('is-open');
      galleryBackdrop.setAttribute('aria-hidden', 'true');
      galleryPanel.setAttribute('aria-hidden', 'true');
      setTimeout(() => {
        if (!galleryPanel.classList.contains('is-open')) {
          galleryBackdrop.setAttribute('hidden', '');
        }
      }, 250);
    }

    if (galleryBtn) {
      galleryBtn.addEventListener('click', () => {
        if (galleryPanel && galleryPanel.classList.contains('is-open')) {
          closeGallery();
        } else {
          openGallery();
        }
      });
    }

    if (galleryCloseBtn) {
      galleryCloseBtn.addEventListener('click', closeGallery);
    }

    if (galleryBackdrop) {
      galleryBackdrop.addEventListener('click', closeGallery);
    }

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (galleryPanel && galleryPanel.classList.contains('is-open')) {
          closeGallery();
        } else if (modalNew && modalNew.classList.contains('is-open')) {
          closeNewModal();
        }
      }
    });
  });
})();
