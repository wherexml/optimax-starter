#!/bin/sh
# Compatibility wrapper: local preview secrets now live in bootstrap-project.sh --local-env.
exec "$(dirname "$0")/bootstrap-project.sh" --local-env
