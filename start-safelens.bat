@echo off
setlocal

set "ROOT=%~dp0"
cd /d "%ROOT%"

echo [1/5] Checking dependencies...
if not exist "node_modules" (
  echo node_modules not found. Installing...
  call npm install
  if errorlevel 1 goto :fail
)

echo [2/5] Starting local services (Postgres, Redis, MinIO)...
docker info >nul 2>&1
if errorlevel 1 (
  echo Docker daemon not reachable. Attempting to start Docker Desktop...
  if exist "C:\Program Files\Docker\Docker\Docker Desktop.exe" (
    start "Docker Desktop" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
  ) else (
    echo Docker Desktop not found at default path.
  )

  for /l %%i in (1,1,60) do (
    timeout /t 2 /nobreak >nul
    docker info >nul 2>&1 && goto :docker_ready
  )

  echo Docker daemon is still unavailable.
  echo Start Docker Desktop manually and rerun this script.
  goto :fail
)

:docker_ready
call docker compose up -d
if errorlevel 1 goto :fail

echo [3/5] Pushing Prisma schema...
call npm run prisma:push --workspace @safelens/api
if errorlevel 1 goto :fail

echo [3.5/5] Generating Prisma client...
call npm run prisma:generate --workspace @safelens/api
if errorlevel 1 goto :fail

echo [4/5] Configuring connected Android devices...
where adb >nul 2>&1
if errorlevel 1 (
  echo adb not found. Skipping Android USB tunnel setup.
) else (
  for /f "skip=1 tokens=1,2" %%a in ('adb devices') do (
    if "%%b"=="device" (
      echo Configuring Android device %%a...
      adb -s %%a reverse tcp:4000 tcp:4000 >nul 2>&1
      if errorlevel 1 (
        echo Could not configure adb reverse for %%a.
      ) else (
        echo API tunnel ready on %%a: Android http://127.0.0.1:4000 -> PC http://localhost:4000
      )
      adb -s %%a shell "run-as com.safelens.app sed -i 's|<string name=""api_base_url"">[^<]*</string>|<string name=""api_base_url"">http://127.0.0.1:4000</string>|' shared_prefs/safelens-session.xml" >nul 2>&1
      if errorlevel 1 (
        echo SafeLens app URL was not changed automatically on %%a. In the Android app, set Server URL to http://127.0.0.1:4000 when using USB.
      ) else (
        echo SafeLens app URL set to http://127.0.0.1:4000 on %%a.
      )
    )
  )
)

echo [5/5] Launching API and Dashboard...
start "SafeLens API" cmd /k "cd /d ""%ROOT%"" && npm run dev:api"
start "SafeLens Dashboard" cmd /k "cd /d ""%ROOT%"" && npm run dev:dashboard"

echo.
echo SafeLens started:
echo API: http://localhost:4000
echo Dashboard: http://localhost:3000
echo Android USB API URL: http://127.0.0.1:4000
echo Keep USB connected for the Android tunnel, or set the app Server URL to a reachable LAN API address.
goto :eof

:fail
echo.
echo Startup failed. Fix the error above and run again.
exit /b 1
