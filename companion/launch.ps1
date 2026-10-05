$ErrorActionPreference = 'Stop'
$taskNode = (Get-Command node -ErrorAction Stop).Source
$taskScript = Join-Path $PSScriptRoot 'monitor.cjs'
$taskProcess = Start-Process -FilePath $taskNode -ArgumentList ('"' + $taskScript + '"') -WindowStyle Hidden -PassThru -Wait
exit $taskProcess.ExitCode
