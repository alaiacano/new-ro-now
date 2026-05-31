## new-ro-monitor pipeline
##
## Safety: every target below only ADDS to or OVERWRITES specific JSON files
## via the `scrape` CLI. No target ever deletes data/, data/doc_cache/, or
## data/documents.db. The SQLite DB uses INSERT OR IGNORE; download skips
## already-fetched files; analyze skips already-analyzed docs. Re-running
## any target is safe.

SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.ONESHELL:

SCRAPE       := uv run --project scraper scrape
CHECK        := python3 scripts/check_record_counts.py
VLLM_URL     ?= http://localhost:8000/v1
VLLM_MODEL   ?= Qwen/Qwen2.5-32B-Instruct
ANALYZE_ARGS ?=

.DEFAULT_GOAL := help

.PHONY: help all quick docs \
        meetings construction paving library bids news \
        discover download analyze export-docs \
        snapshot check \
        backup build dev \
        guard-data

help:
	@echo "new-ro-monitor pipeline targets:"
	@echo ""
	@echo "  Pipeline A (live scrapers, no GPU):"
	@echo "    make quick           - run all Pipeline A scrapers"
	@echo "    make meetings        - iCal meeting feeds"
	@echo "    make construction    - roadway alerts + flood mitigation"
	@echo "    make paving          - paving PDFs"
	@echo "    make library         - library events (LibCal, often blocked)"
	@echo "    make bids            - city bids"
	@echo "    make news            - RSS news + public hearing notices"
	@echo ""
	@echo "  Pipeline B (DocumentCenter mirror, sequential):"
	@echo "    make discover        - walk folder tree -> documents.db"
	@echo "    make download        - download files -> doc_cache/"
	@echo "    make analyze         - LLM classify (needs vLLM, see VLLM_URL/VLLM_MODEL)"
	@echo "    make export-docs     - write doc_*.json from DB"
	@echo "    make docs            - full B chain: discover -> download -> analyze -> export-docs"
	@echo ""
	@echo "  Combined (auto snapshot before, check after):"
	@echo "    make all             - quick + docs"
	@echo ""
	@echo "  Data-loss guard:"
	@echo "    make snapshot        - record current per-file record counts"
	@echo "    make check           - fail if any file shrunk vs snapshot"
	@echo ""
	@echo "  Utilities:"
	@echo "    make backup          - timestamped tarball of data/ JSON + geocache"
	@echo "    make build           - vite build of web/"
	@echo "    make dev             - vite dev server"
	@echo ""
	@echo "  Vars (override on cmdline or env):"
	@echo "    VLLM_URL=$(VLLM_URL)"
	@echo "    VLLM_MODEL=$(VLLM_MODEL)"
	@echo "    ANALYZE_ARGS=$(ANALYZE_ARGS)   # extra flags, e.g. --limit 50"

## ---- guards ----------------------------------------------------------------

# Refuse to run if data/ is missing — protects against running in the wrong cwd.
guard-data:
	@test -d data || { echo "ERROR: data/ not found. Are you in the repo root?"; exit 1; }

## ---- Data-loss guard -------------------------------------------------------

snapshot: guard-data
	$(CHECK) snapshot

check: guard-data
	$(CHECK) check

## ---- Pipeline A ------------------------------------------------------------

# `quick`, `docs`, and `all` snapshot record counts BEFORE running and verify
# AFTER. If any file shrinks (e.g. scraper writes [] over real data because a
# source went temporarily empty), `make check` exits non-zero and `make` halts.
# Individual scraper targets (meetings/bids/etc.) intentionally skip the guard
# so you can iterate on one source without churn -- run `make check` manually
# if you want it.

quick: guard-data snapshot
	$(SCRAPE) all
	$(MAKE) check

meetings: guard-data
	$(SCRAPE) meetings

construction: guard-data
	$(SCRAPE) construction

paving: guard-data
	$(SCRAPE) paving

library: guard-data
	$(SCRAPE) library

bids: guard-data
	$(SCRAPE) bids

news: guard-data
	$(SCRAPE) news

## ---- Pipeline B (sequential; each stage depends on the previous) -----------

discover: guard-data
	$(SCRAPE) discover

download: guard-data
	$(SCRAPE) download

analyze: guard-data
	$(SCRAPE) analyze --api-url $(VLLM_URL) --model $(VLLM_MODEL) $(ANALYZE_ARGS)

export-docs: guard-data
	$(SCRAPE) export-docs

# Full B pipeline as one target. Order matters; `set -e` (from .SHELLFLAGS)
# halts on first failure so a broken stage doesn't poison the next.
docs: guard-data snapshot
	$(SCRAPE) discover
	$(SCRAPE) download
	$(SCRAPE) analyze --api-url $(VLLM_URL) --model $(VLLM_MODEL) $(ANALYZE_ARGS)
	$(SCRAPE) export-docs
	$(MAKE) check

## ---- Combined --------------------------------------------------------------

# `all` snapshots once at the start, runs both pipelines, then checks at the
# end. Sub-targets' own snapshot steps re-record between phases so the final
# check compares post-pipeline counts to pre-pipeline counts is NOT what we
# want; instead we run the scrape stages directly and check at the very end.
all: guard-data snapshot
	$(SCRAPE) all
	$(SCRAPE) discover
	$(SCRAPE) download
	$(SCRAPE) analyze --api-url $(VLLM_URL) --model $(VLLM_MODEL) $(ANALYZE_ARGS)
	$(SCRAPE) export-docs
	$(MAKE) check

## ---- Utilities -------------------------------------------------------------

# Snapshot the irreplaceable bits before risky work. Includes the geocache
# (committed, but expensive to rebuild) and all *.json outputs. documents.db
# and doc_cache/ are excluded — they're huge and can be regenerated by re-running
# `make docs`, but if you want them too, add them by hand.
backup:
	@mkdir -p .backups
	@stamp=$$(date +%Y%m%d-%H%M%S); \
	out=".backups/data-$$stamp.tar.gz"; \
	tar -czf "$$out" data/*.json data/geocache.json 2>/dev/null; \
	echo "Wrote $$out"

build:
	cd web && npm install && npm run build

dev:
	cd web && npm run dev
