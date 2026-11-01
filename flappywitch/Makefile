.PHONY: all serve test check help

PORT ?= 8097
HOST ?= 127.0.0.1
URL_HOST = $(if $(findstring :,$(HOST)),[$(HOST)],$(HOST))
BASE_URL ?= http://$(URL_HOST):$(PORT)/flappywitch/
export BASE_URL

all: test

help:
	@echo "Flappy Witch targets:"
	@echo "  make serve  - Serve the whole arcade"
	@echo "  make test   - Run the Node unit tests"
	@echo "  make check  - Run the Chromium browser check"

serve:
	python3 -m http.server $(PORT) --bind $(HOST) --directory ..

test:
	@node --import ./tools/register-vendor-three.mjs --test test/*.test.mjs

check:
	@node tools/browser-check.mjs
