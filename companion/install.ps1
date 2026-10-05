$ErrorActionPreference = 'Stop'
Import-Module ScheduledTasks
$taskNode = (Get-Command node -ErrorAction Stop).Source
if ([int]((& $taskNode -p 'Number.parseInt(process.versions.node)')) -lt 20) { throw 'Install Node.js 20 or newer first.' }
$taskLaunch = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'launch.ps1')).Path
$taskUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$taskAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $taskLaunch + '"') -WorkingDirectory $PSScriptRoot
$taskTrigger = New-ScheduledTaskTrigger -AtLogOn -User $taskUser
$taskPrincipal = New-ScheduledTaskPrincipal -UserId $taskUser -LogonType Interactive -RunLevel Limited
$taskSettings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName 'OnRe Telegram Monitor' -Action $taskAction -Trigger $taskTrigger -Principal $taskPrincipal -Settings $taskSettings -Description 'Read-only OnRe Position and partial-fill notifications. Keep Windows awake.' -Force | Out-Null
Start-ScheduledTask -TaskName 'OnRe Telegram Monitor'
Write-Output 'Installed. Open http://127.0.0.1:17643 to link your bot, then use Sync Telegram in dashboard Settings.'
