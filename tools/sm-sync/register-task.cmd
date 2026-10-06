@echo off
REM 이 PC에 로그온할 때 동기화 에이전트를 자동 실행하도록 작업 스케줄러에 등록한다.
cd /d "%~dp0"
schtasks /Create /TN "WMS-SM sync agent" /TR "\"%~dp0agent.cmd\"" /SC ONLOGON /RL LIMITED /F
echo.
echo 등록했습니다.
echo   지금 시작:  schtasks /Run /TN "WMS-SM sync agent"
echo   해제:      schtasks /Delete /TN "WMS-SM sync agent" /F
pause
