@echo off
rem Co-op on this machine (docs/MULTIPLAYER.md): starts the co-op server in its own window, then opens the game in two separate
rem browser windows that join it. Put the windows side by side: a tab in the background pauses (its player stands still for the
rem other). Arguments go to the server, e.g. play-coop.bat --seed 1234 (the same forest every time). Friends on the LAN open
rem http://<this machine's IP>:8320/src/?mp=1
cd /d "%~dp0"
start "Riftbound co-op server" node server\server.mjs %*
timeout /t 2 /nobreak >nul
start "" chrome --new-window "http://localhost:8320/src/?mp=1&name=Player1" || start "" "http://localhost:8320/src/?mp=1&name=Player1"
start "" chrome --new-window "http://localhost:8320/src/?mp=1&name=Player2" || start "" "http://localhost:8320/src/?mp=1&name=Player2"
