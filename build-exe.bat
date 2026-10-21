@echo off
setlocal
echo Compiling vtttool.exe...
"C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /optimize /win32icon:public\favicon.ico /out:vtttool.exe launcher\Program.cs
if %ERRORLEVEL% EQU 0 (
    echo [OK] Successfully built vtttool.exe!
    copy /Y vtttool.exe "C:\Users\zafee\Desktop\VttSlideSyncStudio.exe" >nul 2>&1
    echo [OK] Updated Desktop executable as well.
) else (
    echo [ERROR] Compilation failed.
    exit /b 1
)
