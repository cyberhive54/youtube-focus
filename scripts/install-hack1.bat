@echo off
title YouTube Focus - Hack 1 Setup
cd /d "%~dp0"
echo ==============================================================================
echo                YouTube Focus - Hack 1 Launcher
echo ==============================================================================
echo.
echo Launching Shortcut Injection Tool with Administrator privileges...
echo (If prompted by Windows User Account Control, click "Yes")
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-hack1.ps1"

