#!/bin/bash
# Double-click in Finder: starts Riftbound's co-op server and opens the forest (play-mac.sh does the work; play.bat on Windows).
cd "$(dirname "$0")" && exec bash ./play-mac.sh "$@"
