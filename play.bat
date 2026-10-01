@echo off
rem Starts a local web server (needed to load the 3D models) and opens the game (src/; the old 2D game is concepts/legacy-game).
cd /d "%~dp0"
start "" http://localhost:8123/src/index.html
python serve.py 8123
