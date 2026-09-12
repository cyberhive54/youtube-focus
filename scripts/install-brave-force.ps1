# ==============================================================================
# YouTube Focus - Brave Enterprise Force-Install & Uninstall Protection
# Makes YouTube Focus permanently installed in Brave across all profiles.
# The 'Remove' button in brave://extensions is completely disabled/greyed out.
# ==============================================================================

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "Requesting Administrator permissions..." -ForegroundColor Yellow
    Start-Process powershell.exe -Verb RunAs -ArgumentList ("-NoProfile -ExecutionPolicy Bypass -NoExit -File `"$PSCommandPath`"")
    exit
}

$Host.UI.RawUI.WindowTitle = "YouTube Focus - Brave Uninstall Protection Tool"

$extId = "lbolmjfaffmiakolleghaplidjlnlphe"
$updateUrl = "https://raw.githubusercontent.com/cyberhive54/youtube-focus/main/update.xml"
$policyValue = "$extId;$updateUrl"
$policyRegKey = "HKLM:\SOFTWARE\Policies\BraveSoftware\Brave-Browser\ExtensionInstallForcelist"

function Show-Header {
    Clear-Host
    Write-Host "==============================================================================" -ForegroundColor Cyan
    Write-Host "        YouTube Focus - Brave Enterprise Uninstall Protection                 " -ForegroundColor White
    Write-Host "==============================================================================" -ForegroundColor Cyan
    Write-Host "Extension ID : $extId" -ForegroundColor Gray
    Write-Host "Update URL   : $updateUrl" -ForegroundColor Gray
    Write-Host ""
}

function Enable-Protection {
    Show-Header
    Write-Host "Applying Brave Enterprise Policy..." -ForegroundColor Yellow

    try {
        if (-not (Test-Path $policyRegKey)) {
            New-Item -Path $policyRegKey -Force | Out-Null
        }
        
        # Check existing values to not overwrite other extensions
        $props = Get-ItemProperty -Path $policyRegKey -ErrorAction SilentlyContinue
        $found = $false
        $nextSlot = 1

        if ($props) {
            foreach ($p in $props.PSObject.Properties) {
                if ($p.Name -match "^\d+$") {
                    $slotNum = [int]$p.Name
                    if ($slotNum -ge $nextSlot) { $nextSlot = $slotNum + 1 }
                    if ($p.Value -like "*$extId*") {
                        Set-ItemProperty -Path $policyRegKey -Name $p.Name -Value $policyValue -Force
                        $found = $true
                        Write-Host "  [OK] Updated slot $($p.Name) with current update URL." -ForegroundColor Green
                        break
                    }
                }
            }
        }

        if (-not $found) {
            Set-ItemProperty -Path $policyRegKey -Name "$nextSlot" -Value $policyValue -Force
            Write-Host "  [OK] Registered policy at slot $nextSlot." -ForegroundColor Green
        }

        Write-Host ""
        Write-Host "SUCCESS: Policy applied to Brave!" -ForegroundColor Green
        Write-Host ""
        
        $running = Get-Process brave -ErrorAction SilentlyContinue
        if ($running) {
            Write-Host "Brave is currently running." -ForegroundColor Yellow
            $resp = Read-Host "Close Brave now so it reloads the policy? (Y/N)"
            if ($resp -eq 'Y' -or $resp -eq 'y') {
                Stop-Process -Name brave -Force -ErrorAction SilentlyContinue
                Write-Host "Closed Brave. Launch it again to see the protection active!" -ForegroundColor Green
            }
        } else {
            Write-Host "Launch Brave to see YouTube Focus permanently installed and protected!" -ForegroundColor Green
        }

    } catch {
        Write-Host "  [ERROR] Failed to apply policy: $_" -ForegroundColor Red
    }

    Write-Host ""
    Read-Host "Press Enter to continue"
}

function Disable-Protection {
    Show-Header
    Write-Host "Removing Brave Enterprise Policy..." -ForegroundColor Yellow

    if (Test-Path $policyRegKey) {
        $props = Get-ItemProperty -Path $policyRegKey -ErrorAction SilentlyContinue
        $removed = $false
        if ($props) {
            foreach ($p in $props.PSObject.Properties) {
                if ($p.Value -like "*$extId*") {
                    Remove-ItemProperty -Path $policyRegKey -Name $p.Name -Force -ErrorAction SilentlyContinue
                    Write-Host "  [OK] Removed YouTube Focus policy from slot $($p.Name)." -ForegroundColor Green
                    $removed = $true
                }
            }
        }
        if (-not $removed) {
            Write-Host "  [--] YouTube Focus policy was not present." -ForegroundColor Gray
        }
    } else {
        Write-Host "  [--] Policy key does not exist." -ForegroundColor Gray
    }

    Write-Host ""
    Write-Host "SUCCESS: Policy removed." -ForegroundColor Green
    Write-Host ""
    Read-Host "Press Enter to continue"
}

function View-Status {
    Show-Header
    Write-Host "Current Brave Policy Status:" -ForegroundColor Yellow
    Write-Host ""

    if (Test-Path $policyRegKey) {
        $props = Get-ItemProperty -Path $policyRegKey -ErrorAction SilentlyContinue
        $found = $false
        if ($props) {
            foreach ($p in $props.PSObject.Properties) {
                if ($p.Name -match "^\d+$") {
                    Write-Host "  Slot $($p.Name) : $($p.Value)" -ForegroundColor Cyan
                    if ($p.Value -like "*$extId*") { $found = $true }
                }
            }
        }
        if ($found) {
            Write-Host ""
            Write-Host "STATUS: YouTube Focus is [PROTECTED / FORCE-INSTALLED]" -ForegroundColor Green
        } else {
            Write-Host ""
            Write-Host "STATUS: YouTube Focus is [NOT CONFIGURED IN POLICY]" -ForegroundColor Gray
        }
    } else {
        Write-Host "STATUS: No Brave extension policies configured." -ForegroundColor Gray
    }

    Write-Host ""
    Read-Host "Press Enter to continue"
}

while ($true) {
    Show-Header
    Write-Host "Options:" -ForegroundColor White
    Write-Host "  [1] Enable Uninstall Protection in Brave (Force-Install)" -ForegroundColor Green
    Write-Host "  [2] View Current Brave Policy Status" -ForegroundColor Cyan
    Write-Host "  [3] Disable Uninstall Protection in Brave (Revert)" -ForegroundColor Yellow
    Write-Host "  [Q] Exit" -ForegroundColor Gray
    Write-Host ""

    $choice = Read-Host "Select an option"
    switch ($choice) {
        "1" { Enable-Protection }
        "2" { View-Status }
        "3" { Disable-Protection }
        "Q" { exit }
        "q" { exit }
    }
}
