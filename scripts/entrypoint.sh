#!/bin/sh
set -e

# Run migrations, then start the standalone server.
node migrations/up.js
exec node server.js
