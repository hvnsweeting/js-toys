.PHONY: all serve test check help

PORT ?= 8000
HOST ?= 127.0.0.1
# Where make check finds the game: make serve's address unless given. A numeric IPv6 host (::1)
# goes in square brackets in a web address.
URL_HOST = $(if $(findstring :,$(HOST)),[$(HOST)],$(HOST))
BASE_URL ?= http://$(URL_HOST):$(PORT)/treediff/
# Handed to the check as an environment variable, not written into the shell command, so any
# character in the address (& or ' or a space) reaches it unchanged.
export BASE_URL

all: test

help:
	@echo "Tree Appreciator - Available targets:"
	@echo "  make serve  - Start local HTTP server (whole arcade, so Back to Arcade works)"
	@echo "  make test   - Run the Node unit tests (needs Node only)"
	@echo "  make check  - Run the headless Chromium browser check (needs Chromium, and make serve running)"

serve:
	@echo "Starting Tree Appreciator at http://$(URL_HOST):$(PORT)/treediff/"
	python3 -m http.server $(PORT) --bind $(HOST) --directory ..

test:
	@echo "Running Tree Appreciator unit tests..."
	@node --import ./tools/register-vendor-three.mjs --test test/*.test.js

check:
	@node tools/browser-check.mjs
