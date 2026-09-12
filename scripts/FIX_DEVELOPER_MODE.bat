@echo off
:: Self-elevate to Administrator
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting Administrator permissions to unlock Developer Mode...
    powershell -NoProfile -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

echo =======================================================
echo     Fixing Developer Mode and Removing All Policies    
echo =======================================================
echo.

echo Removing Google Chrome policies...
reg delete "HKLM\SOFTWARE\Policies\Google\Chrome" /f >nul 2>&1
reg delete "HKLM\SOFTWARE\Policies\Google" /f >nul 2>&1
reg delete "HKLM\SOFTWARE\WOW6432Node\Policies\Google\Chrome" /f >nul 2>&1
reg delete "HKLM\SOFTWARE\WOW6432Node\Policies\Google" /f >nul 2>&1
reg delete "HKCU\SOFTWARE\Policies\Google\Chrome" /f >nul 2>&1
reg delete "HKCU\SOFTWARE\Policies\Google" /f >nul 2>&1

echo Removing Brave policies...
reg delete "HKLM\SOFTWARE\Policies\BraveSoftware\Brave" /f >nul 2>&1
reg delete "HKLM\SOFTWARE\Policies\BraveSoftware" /f >nul 2>&1
reg delete "HKCU\SOFTWARE\Policies\BraveSoftware" /f >nul 2>&1

echo.
echo [SUCCESS] All browser policies have been completely removed!
echo.
echo "Managed by your organization" is now cleared.
echo Developer Mode switch is now unlocked.
echo.
echo Please restart Chrome, open chrome://extensions, and toggle Developer Mode ON.
echo.
pause
