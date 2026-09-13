@echo off
REM Build the Tauri desktop app inside the MSVC (vcvars64) environment.
REM Usage: scripts\build-tauri.bat  (or run the dev variant below)
setlocal

for /f "usebackq tokens=*" %%i in (`"%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VSPATH=%%i"

if not defined VSPATH (
  echo ERROR: Visual Studio C++ build tools not found via vswhere.
  exit /b 1
)

call "%VSPATH%\VC\Auxiliary\Build\vcvars64.bat"
if errorlevel 1 exit /b 1

set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

cd /d "%~dp0..\apps\desktop"
npm run tauri build
