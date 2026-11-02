@echo off
rem Holt den aktuellen Plan aus Rapla, baut die Seite und oeffnet sie im Browser.
cd /d "%~dp0"
node build.mjs || (
  echo Rapla nicht erreichbar, baue aus den zuletzt geladenen Daten.
  node build.mjs --offline
)
start "" http://localhost:8137
node serve.mjs
