@echo off
REM 최초 1회: 의존성 설치.
REM Scenario Manager 로그인은 따로 하지 않는다 - WMS 관리자 로그인할 때
REM 그 계정으로 에이전트가 알아서 로그인한다(두 시스템의 계정이 같다).
cd /d "%~dp0"
call npm install
echo.
echo 설치가 끝났습니다. register-task.cmd 를 실행하면 로그온할 때마다 에이전트가 자동 실행됩니다.
pause
