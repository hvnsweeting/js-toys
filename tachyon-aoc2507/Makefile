.PHONY: all serve test check help

PORT ?= 8000
HOST ?= 127.0.0.1

all: test

help:
	@echo "Tachyon Cascade - Available targets:"
	@echo "  make serve  - Start local HTTP server (whole arcade, so Back to Arcade works)"
	@echo "  make test   - Run the Node test suite (npm test)"
	@echo "  make check  - Run the headless Chromium browser check (npm run check)"

serve:
	@echo "Starting Tachyon Cascade at http://$(HOST):$(PORT)/tachyon-aoc2507/"
	python3 -m http.server $(PORT) --bind $(HOST) --directory ..

test:
	@echo "Running Tachyon Cascade test suite..."
	@npm test

check:
	@npm run check
