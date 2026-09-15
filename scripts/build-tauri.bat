@echo off
REM Build the Tauri desktop app inside the MSVC (vcvars64) environment.
REM
REM cargo cannot replace target\release\poe2-build-coach.exe while a copy of it is
REM running: the link step dies with "failed to remove file ...: access denied,
REM os error 5". So any running copy is force-closed first, and the fresh build is
REM launched once it succeeds. Run this from a terminal; it does not pause.
REM
REM Usage: scripts\build-tauri.bat [--no-start]
REM   --no-start   build the installer without launching the result
REM
REM Keep this file ASCII-only. cmd.exe reads .bat in the OEM code page, so
REM non-ASCII comments are mis-decoded and the garbage gets run as commands.
setlocal

set "APP=poe2-build-coach.exe"
set "BIN=%~dp0..\apps\desktop\src-tauri\target\release\%APP%"

REM taskkill exits 128 when nothing matched, which is not an error here, so its
REM exit code is deliberately ignored. There is no tasklist/find probe either:
REM run from Git Bash, find.exe resolves to the GNU one from Git, which rejects
REM the Windows switches.
taskkill /F /IM "%APP%" >nul 2>&1

REM taskkill returns before Windows has unmapped the image, and WebView2 child
REM processes can hold it a little longer than the process that spawned them, so
REM wait for the delete to actually take rather than guessing a fixed sleep.
set /a attempts=0
:wait
if not exist "%BIN%" goto :ready
del /F /Q "%BIN%" >nul 2>&1
if not exist "%BIN%" goto :ready
set /a attempts+=1
if %attempts% GEQ 10 goto :locked
"%SystemRoot%\System32\ping.exe" -n 2 127.0.0.1 >nul
goto :wait

:locked
echo ERROR: %BIN%
echo        is still locked by another process. Close the running app and retry.
exit /b 1

:ready
for /f "usebackq tokens=*" %%i in (`"%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VSPATH=%%i"

if not defined VSPATH goto :novs

call "%VSPATH%\VC\Auxiliary\Build\vcvars64.bat"
if errorlevel 1 exit /b 1

set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

cd /d "%~dp0..\apps\desktop"
REM npm is a .cmd, so it needs call or this script never gets control back.
call npm run tauri build
if errorlevel 1 goto :failed

if /i "%~1"=="--no-start" goto :done

echo Starting the new build ...
start "" "%BIN%"
exit /b 0

:novs
echo ERROR: Visual Studio C++ build tools not found via vswhere.
exit /b 1

:failed
echo.
echo BUILD FAILED
exit /b 1

:done
echo Build finished without launching. Installer: src-tauri\target\release\bundle\nsis\
exit /b 0
