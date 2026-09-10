.PHONY: install format-check lint lint-fix typecheck test build test-interop lint-package gate clean

install:
	npm ci

format-check:
	npm run format:check

lint:
	npm run lint

lint-fix:
	npm run lint:fix

typecheck:
	npm run typecheck

test:
	npm run test

build:
	npm run build

test-interop:
	npm run test:interop

lint-package:
	npm run lint:package

gate: format-check lint typecheck test build test-interop lint-package

clean:
	rm -rf dist coverage
