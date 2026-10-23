@echo off
rem Starts the game's server (node server\server.mjs: the files and the co-op room; needs Node, nodejs.org) and opens the game
rem in the forest. Friends on the same network open http://<this machine's IP>:8320/src/?mp=1 (play-coop.bat: two windows here).
rem The old 2D game is concepts/legacy-game.
cd /d "%~dp0"
where node >nul 2>nul || (echo Riftbound needs Node: install the LTS version from https://nodejs.org and run this again. & pause & exit /b 1)
start "Riftbound server" node server\server.mjs %*
timeout /t 2 /nobreak >nul
start "" "http://localhost:8320/src/?mp=1"
