@echo off
rem Tomato Clock launcher (ASCII only to avoid codepage issues)
set "ELECTRON_RUN_AS_NODE="
start "" "%~dp0app\node_modules\electron\dist\electron.exe" "%~dp0app"
