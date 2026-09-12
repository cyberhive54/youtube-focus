@echo off
title YouTube Focus - Brave Uninstall Protection Setup
cd /d "%~dp0"
echo ==============================================================================
echo        YouTube Focus - Brave Enterprise Force-Install Launcher
echo ==============================================================================
echo.
echo Launching Brave Policy Tool with Administrator privileges...
echo (If prompted by Windows User Account Control, click "Yes")
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-brave-force.ps1"
