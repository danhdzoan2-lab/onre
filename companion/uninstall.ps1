$ErrorActionPreference = 'Stop'
$taskExisting = Get-ScheduledTask -TaskName 'OnRe Telegram Monitor' -ErrorAction SilentlyContinue
if ($taskExisting) { Stop-ScheduledTask -TaskName 'OnRe Telegram Monitor'; Unregister-ScheduledTask -TaskName 'OnRe Telegram Monitor' -Confirm:$false }
Write-Output 'Startup task removed. Configuration is retained in LocalAppData\OnReTelegram. Use Disconnect in local settings to remove stored bot credentials before uninstalling.'
