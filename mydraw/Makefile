.PHONY: all serve test help

PORT ?= 8000

all: test

help:
	@echo "MyDraw - Available Makefile targets:"
	@echo "  make serve    - Start a local HTTP server at http://localhost:\$$(PORT)"
	@echo "  make test     - Run the test suite via headless browser"

serve:
	@echo "Starting MyDraw server at http://localhost:$(PORT)..."
	python3 -m http.server $(PORT)

test:
	@echo "Running MyDraw test suite..."
	@python3 tests/run-tests.py
