@echo off
REM Scenario Manager 동기화 에이전트.
REM WMS 관리자 로그인에서 넘겨받은 계정으로 SM에 로그인하고,
REM 대여 확인/반납이 일어나면 그 물품만 SM에 바로 반영한다.
cd /d "%~dp0"
node agent.mjs --interval=15
