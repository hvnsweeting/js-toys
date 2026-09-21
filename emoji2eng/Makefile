.PHONY: all serve test help

PORT ?= 8000

all: test

help:
	@echo "emoji2eng - Available targets:"
	@echo "  make serve  - Start local HTTP server"
	@echo "  make test   - Run test suite via headless browser"

serve:
	@echo "Starting emoji2eng at http://localhost:$(PORT)/emoji2eng/"
	python3 -m http.server $(PORT) --directory ..

test:
	@echo "Running emoji2eng test suite..."
	@python3 tests/run-tests.py
