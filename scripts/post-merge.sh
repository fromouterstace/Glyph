#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm check:database
# No automatic schema mutation. A schema-changing merge needs a reviewed,
# explicitly targeted development push; production changes use Publish only.
