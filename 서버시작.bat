@echo off
cd /d "%~dp0"
title Church Manager - Local Server (port 8002)
echo.
echo   Church Manager - Local Server
echo   ----------------------------------------
echo   URL    : http://localhost:8002
echo   Folder : %cd%
echo   Stop   : close this window or press Ctrl+C
echo   ----------------------------------------
echo.
start "" http://localhost:8002
python serve.py 8002
echo.
echo   Server stopped. Press any key to close.
pause >nul
