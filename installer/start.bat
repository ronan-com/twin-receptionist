@echo off
rem Windows: double-click this file to start the setup.
cd /d "%~dp0"
if "%IMAGE%"=="" set IMAGE=receptionist-installer:latest
where docker >nul 2>nul || (echo Docker is not installed. Install Docker Desktop from https://www.docker.com/products/docker-desktop/ then run this again. & pause & exit /b 1)
docker info >nul 2>nul || (echo Docker is not running. Open Docker Desktop, wait until it says it is running, then run this again. & pause & exit /b 1)
docker image inspect %IMAGE% >nul 2>nul
if errorlevel 1 (
  if exist receptionist-installer-image.tar.gz (
    echo Loading the installer ^(first time only, about a minute^)...
    docker load -i receptionist-installer-image.tar.gz >nul
  ) else (
    docker pull %IMAGE%
  )
)
docker rm -f receptionist-setup >nul 2>nul
docker run -d --rm --name receptionist-setup -p 127.0.0.1:4400:4400 -v receptionist-setup-data:/state %IMAGE% >nul
if errorlevel 1 (echo Could not start the setup. & pause & exit /b 1)
for /l %%i in (1,1,60) do (
  curl -fsS -o nul http://localhost:4400/api/state 2>nul && goto :ready
  timeout /t 1 /nobreak >nul
)
:ready
echo Setup is running at http://localhost:4400
start "" http://localhost:4400
echo When you are finished, you can stop it with:  docker stop receptionist-setup
pause
