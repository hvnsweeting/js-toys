.PHONY: all serve test check help

PORT ?= 8097
HOST ?= 127.0.0.1
URL_HOST = $(if $(findstring :,$(HOST)),[$(HOST)],$(HOST))
BASE_URL ?= http://$(URL_HOST):$(PORT)/jigsaw/
export BASE_URL

all: test

help:
	@echo "Jigsaw targets:"
	@echo "  make serve  - Serve the arcade on PORT (default 8097)"
	@echo "  make test   - Run Node and Python tests"
	@echo "  make check  - Run browser and music level checks against BASE_URL"

serve:
	python3 -m http.server $(PORT) --bind $(HOST) --directory ..

test:
	@node --test tests/*.test.mjs
	@python3 -m unittest discover -s tests -p '*_test.py'

check:
	@BROWSER_CHECK_SECTION=viewports node tools/browser-check.mjs
	@BROWSER_CHECK_SECTION=scenarios node tools/browser-check.mjs
	@BROWSER_CHECK_SECTION=integration node tools/browser-check.mjs
	@BROWSER_CHECK_SECTION=offline node tools/browser-check.mjs
	@node tools/music-render.mjs
