@echo off
rem Open Finance launcher (Windows)
cd /d "%~dp0\.."

if not exist node_modules (
  echo Installing dependencies...
  call corepack enable
  call pnpm install --frozen-lockfile
)
if not exist .next\standalone (
  echo Building...
  call pnpm build
)

set NODE_ENV=production
set HOSTNAME=127.0.0.1
if "%PORT%"=="" set PORT=3000

node migrations\up.js
if not exist data mkdir data

start "" cmd /c "timeout /t 8 >nul & start http://127.0.0.1:%PORT%"
node .next\standalone\server.js
