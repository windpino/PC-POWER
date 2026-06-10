@echo off
cd /d "%~dp0"
title PC Power Agent Installer

echo =================================================================
echo        PC Power Agent Service Installer
echo =================================================================
echo.

:: 1. Node.js check
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed.
    echo Please install from https://nodejs.org and try again.
    echo.
    pause
    exit /b 1
)

:: 2. Install dependencies
echo [1/4] Installing npm packages...
call npm install
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install packages. Check internet connection.
    echo.
    pause
    exit /b 1
)
echo [SUCCESS] Packages installed.
echo.

:: 3. Create run-agent-silent.vbs
echo [2/4] Creating silent run script...
set "VBS_FILE=%~dp0run-agent-silent.vbs"
(
echo Set WshShell = CreateObject("WScript.Shell"^)
echo currentDir = CreateObject("Scripting.FileSystemObject"^).GetParentFolderName(WScript.ScriptFullName^)
echo WshShell.Run "cmd.exe /c node """ ^& currentDir ^& "\agent.js"" >> """ ^& currentDir ^& "\agent.log"" 2>&1", 0, false
) > "%VBS_FILE%"
echo [SUCCESS] VBScript created.
echo.

:: 4. Create startup shortcut via PowerShell
echo [3/4] Registering startup program...
set "LNK_PATH=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\PC_Power_Agent.lnk"
set "VBS_TARGET=%~dp0run-agent-silent.vbs"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s = New-Object -ComObject WScript.Shell; $u = $s.CreateShortcut('%LNK_PATH%'); $u.TargetPath = 'wscript.exe'; $u.Arguments = '\"%VBS_TARGET%\"'; $u.WorkingDirectory = '%~dp0'; $u.Save();"

if %errorlevel% neq 0 (
    echo [WARNING] Startup registration failed.
) else (
    echo [SUCCESS] Startup registered successfully.
)
echo.

:: 5. Launch Agent Immediately
echo [4/4] Starting agent service...
wscript.exe "%VBS_FILE%"
if %errorlevel% neq 0 (
    echo [ERROR] Failed to start agent.
) else (
    echo [SUCCESS] Agent is running in background.
    echo.
    echo =================================================================
    echo Setup Complete!
    echo Please check your web dashboard (should be ONLINE).
    echo =================================================================
)
echo.
pause