# ==============================================================================
# YouTube Focus - Hack 1: Command-Line Auto-Injection
# Adds --load-extension="D:\youtube-focus" to all Chrome & Brave shortcuts
# and Windows launch commands.
#
# Result in Chrome / Brave:
#   1. "Remove" button is COMPLETELY GONE from chrome://extensions UI.
#   2. "Source: Command line" prevents in-browser uninstallation.
#   3. Works across all profiles.
#   4. ALL other extensions stay 100% normal and untouched.
#   5. No "managed by organization" banner.
# ==============================================================================

# Ensure Administrator Privileges (needed for Public Desktop & Start Menu shortcuts)
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "Requesting Administrator permissions..." -ForegroundColor Yellow
    Start-Process powershell.exe -Verb RunAs -ArgumentList ("-NoProfile -ExecutionPolicy Bypass -NoExit -File `"$PSCommandPath`"")
    exit
}

$Host.UI.RawUI.WindowTitle = "YouTube Focus - Shortcut Protection Tool (Hack 1)"
$scriptDir = Split-Path -Parent $PSCommandPath
$extensionDir = Split-Path -Parent $scriptDir
$flag = "--load-extension=`"$extensionDir`""

function Show-Header {
    Clear-Host
    Write-Host "==============================================================================" -ForegroundColor Cyan
    Write-Host "            YouTube Focus - Shortcut Injection Tool (Hack 1)                  " -ForegroundColor White
    Write-Host "==============================================================================" -ForegroundColor Cyan
    Write-Host "Extension Folder : $extensionDir" -ForegroundColor Gray
    Write-Host "Flag to Inject   : $flag" -ForegroundColor Gray
    Write-Host ""
}

function Get-TargetShortcuts {
    $searchRoots = @(
        "$env:PUBLIC\Desktop",
        "$env:USERPROFILE\Desktop",
        "$env:PROGRAMDATA\Microsoft\Windows\Start Menu\Programs",
        "$env:APPDATA\Microsoft\Windows\Start Menu\Programs",
        "$env:APPDATA\Microsoft\Internet Explorer\Quick Launch",
        "$env:APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar",
        "$env:APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\ImplicitAppShortcuts"
    )

    $wsh = New-Object -ComObject WScript.Shell
    $shortcuts = @()
    foreach ($root in $searchRoots) {
        if (Test-Path $root) {
            $found = Get-ChildItem -LiteralPath $root -Recurse -Filter "*.lnk" -Force -ErrorAction SilentlyContinue | Where-Object {
                if ($_.Name -match "^(Google Chrome|Brave).*\.lnk$") { return $true }
                try {
                    $sc = $wsh.CreateShortcut($_.FullName)
                    return ($sc.TargetPath -match "(chrome|brave)\.exe$")
                } catch { return $false }
            }
            if ($found) {
                $shortcuts += $found
            }
        }
    }
    # Return unique by FullName
    return ($shortcuts | Sort-Object -Property FullName -Unique)
}

function Apply-Hack1 {
    Show-Header
    Write-Host "Applying --load-extension to all Chrome & Brave shortcuts..." -ForegroundColor Yellow
    Write-Host ""

    $wsh = New-Object -ComObject WScript.Shell
    $shortcuts = Get-TargetShortcuts
    $count = 0

    foreach ($s in $shortcuts) {
        try {
            $sc = $wsh.CreateShortcut($s.FullName)
            $args = if ($sc.Arguments) { $sc.Arguments } else { "" }
            
            # Check if flag already exists
            if ($args -notmatch "--load-extension") {
                if ($args.Length -gt 0) {
                    $sc.Arguments = "$flag $args"
                } else {
                    $sc.Arguments = $flag
                }
                $sc.Save()
                Write-Host "  [OK] Updated: $($s.Name)" -ForegroundColor Green
                Write-Host "       Path   : $($s.FullName)" -ForegroundColor Gray
                Write-Host "       Args   : $($sc.Arguments)" -ForegroundColor Cyan
                $count++
            } else {
                Write-Host "  [--] Already set: $($s.Name)" -ForegroundColor Gray
            }
        } catch {
            Write-Host "  [!] Error updating $($s.FullName): $_" -ForegroundColor Red
        }
    }

    # Also update Windows Default Browser registry command for clicking links in apps
    Write-Host ""
    Write-Host "Updating Windows link handlers (when clicking links in other apps)..." -ForegroundColor Yellow

    $regTargets = @(
        "HKLM:\SOFTWARE\Classes\ChromeHTML\shell\open\command",
        "HKLM:\SOFTWARE\Classes\BraveHTML\shell\open\command",
        "HKCU:\SOFTWARE\Classes\ChromeHTML\shell\open\command",
        "HKCU:\SOFTWARE\Classes\BraveHTML\shell\open\command"
    )

    foreach ($reg in $regTargets) {
        if (Test-Path $reg) {
            try {
                $val = (Get-ItemProperty -Path $reg).'(default)'
                if ($val -and ($val -notmatch "--load-extension")) {
                    # Inject flag before %1 or at end
                    if ($val -match '--single-argument') {
                        $newVal = $val -replace '--single-argument', "$flag --single-argument"
                    } else {
                        $newVal = "$val $flag"
                    }
                    Set-ItemProperty -Path $reg -Name '(default)' -Value $newVal -Force
                    Write-Host "  [OK] Updated link handler: $reg" -ForegroundColor Green
                }
            } catch {}
        }
    }

    Write-Host ""
    Write-Host "SUCCESS: Shortcut arguments and link handlers updated!" -ForegroundColor Green

    # Check if Chrome or Brave is running
    $runningProcs = Get-Process chrome, brave -ErrorAction SilentlyContinue
    if ($runningProcs) {
        Write-Host ""
        Write-Host "CRITICAL NOTICE:" -ForegroundColor Yellow
        Write-Host "Chrome and/or Brave are currently running in the background." -ForegroundColor White
        Write-Host "Chromium will IGNORE shortcut flags if an existing browser process is alive." -ForegroundColor Cyan
        Write-Host ""
        $closeNow = Read-Host "Close running Chrome/Brave processes now so the changes take effect? (Y/N)"
        if ($closeNow -eq 'Y' -or $closeNow -eq 'y') {
            Stop-Process -Name chrome, brave -Force -ErrorAction SilentlyContinue
            Write-Host "Closed all background browser processes." -ForegroundColor Green
            Start-Sleep -Seconds 2
        } else {
            Write-Host "NOTE: You MUST completely close all Chrome and Brave windows before launching!" -ForegroundColor Yellow
        }
    }

    Write-Host ""
    Write-Host "Next step:" -ForegroundColor White
    Write-Host "Launch Chrome or Brave from your Desktop, Taskbar, or Start Menu." -ForegroundColor White
    Write-Host "Open chrome://extensions - YouTube Focus will appear with NO 'Remove' button!" -ForegroundColor Green
    Write-Host ""
    Read-Host "Press Enter to continue"
}

function Revert-Hack1 {
    Show-Header
    Write-Host "Reverting shortcuts back to default (removing --load-extension)..." -ForegroundColor Yellow
    Write-Host ""

    $wsh = New-Object -ComObject WScript.Shell
    $shortcuts = Get-TargetShortcuts
    $count = 0

    foreach ($s in $shortcuts) {
        try {
            $sc = $wsh.CreateShortcut($s.FullName)
            $args = if ($sc.Arguments) { $sc.Arguments } else { "" }
            
            if ($args -match "--load-extension") {
                # Clean flag
                $newArgs = $args -replace "--load-extension=`"[^`"]+`"", ""
                $newArgs = $newArgs -replace "--load-extension=\S+", ""
                $newArgs = $newArgs.Trim()
                $sc.Arguments = $newArgs
                $sc.Save()
                Write-Host "  [OK] Cleaned: $($s.Name)" -ForegroundColor Green
                $count++
            }
        } catch {
            Write-Host "  [!] Error: $_" -ForegroundColor Red
        }
    }

    $regTargets = @(
        "HKLM:\SOFTWARE\Classes\ChromeHTML\shell\open\command",
        "HKLM:\SOFTWARE\Classes\BraveHTML\shell\open\command",
        "HKCU:\SOFTWARE\Classes\ChromeHTML\shell\open\command",
        "HKCU:\SOFTWARE\Classes\BraveHTML\shell\open\command"
    )
    foreach ($reg in $regTargets) {
        if (Test-Path $reg) {
            try {
                $val = (Get-ItemProperty -Path $reg).'(default)'
                if ($val -and ($val -match "--load-extension")) {
                    $newVal = $val -replace "--load-extension=`"[^`"]+`"\s*", ""
                    $newVal = $newVal -replace "--load-extension=\S+\s*", ""
                    Set-ItemProperty -Path $reg -Name '(default)' -Value $newVal -Force
                    Write-Host "  [OK] Cleaned link handler: $reg" -ForegroundColor Green
                }
            } catch {}
        }
    }

    Write-Host ""
    Write-Host "SUCCESS: Reverted $count shortcut(s) back to original state." -ForegroundColor Green
    Write-Host ""
    Read-Host "Press Enter to continue"
}

function View-Status {
    Show-Header
    Write-Host "Shortcut and Browser Launch Status:" -ForegroundColor Yellow
    Write-Host ""

    $wsh = New-Object -ComObject WScript.Shell
    $shortcuts = Get-TargetShortcuts

    foreach ($s in $shortcuts) {
        $sc = $wsh.CreateShortcut($s.FullName)
        $hasFlag = ($sc.Arguments -and ($sc.Arguments -match "--load-extension"))
        if ($hasFlag) {
            Write-Host "  [PROTECTED] $($s.Name)" -ForegroundColor Green
            Write-Host "              Path: $($s.FullName)" -ForegroundColor Gray
            Write-Host "              Args: $($sc.Arguments)" -ForegroundColor Cyan
        } else {
            Write-Host "  [STANDARD]  $($s.Name)" -ForegroundColor Gray
            Write-Host "              Path: $($s.FullName)" -ForegroundColor DarkGray
        }
    }
    Write-Host ""
    Read-Host "Press Enter to continue"
}

# Main Loop
while ($true) {
    Show-Header
    Write-Host "Options:" -ForegroundColor White
    Write-Host "  [1] Apply Hack 1 (Inject --load-extension into all Chrome & Brave shortcuts)" -ForegroundColor Green
    Write-Host "  [2] View Current Status of Shortcuts" -ForegroundColor Cyan
    Write-Host "  [3] Revert Shortcuts back to Default" -ForegroundColor Yellow
    Write-Host "  [Q] Exit" -ForegroundColor Gray
    Write-Host ""

    $action = Read-Host "Select an option"
    switch ($action) {
        "1" { Apply-Hack1 }
        "2" { View-Status }
        "3" { Revert-Hack1 }
        "Q" { exit }
        "q" { exit }
    }
}
