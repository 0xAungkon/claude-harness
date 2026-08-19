@echo off
setlocal
call npm install || exit /b 1
call npm run binary || exit /b 1
endlocal
