param(
  [string]$ProjectRef = "wgtxlfswdzwovipyrkfh",
  [string]$AccessToken = $env:SUPABASE_ACCESS_TOKEN,
  [string]$ResendApiKey = $env:RESEND_API_KEY,
  [string]$FromEmail = $env:FIXNOTE_AUTH_FROM_EMAIL,
  [string]$SenderName = "FixNote"
)

$ErrorActionPreference = "Stop"

function Get-DotEnvValue {
  param(
    [string]$Path,
    [string]$Name
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return $null
  }

  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match "^\s*$([regex]::Escape($Name))\s*=\s*(.*)\s*$") {
      return $matches[1].Trim().Trim('"').Trim("'")
    }
  }

  return $null
}

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$dotEnvPath = Join-Path $repositoryRoot ".env"

if ([string]::IsNullOrWhiteSpace($AccessToken)) {
  $AccessToken = Get-DotEnvValue -Path $dotEnvPath -Name "SUPABASE_ACCESS_TOKEN"
}
if ([string]::IsNullOrWhiteSpace($ResendApiKey)) {
  $ResendApiKey = Get-DotEnvValue -Path $dotEnvPath -Name "RESEND_API_KEY"
}
if ([string]::IsNullOrWhiteSpace($FromEmail)) {
  $FromEmail = Get-DotEnvValue -Path $dotEnvPath -Name "FIXNOTE_AUTH_FROM_EMAIL"
}

if ([string]::IsNullOrWhiteSpace($AccessToken)) {
  throw "SUPABASE_ACCESS_TOKEN is required in the environment or .env."
}
if ([string]::IsNullOrWhiteSpace($FromEmail) -or $FromEmail -notmatch "^[^@\s]+@[^@\s]+\.[^@\s]+$") {
  throw "FIXNOTE_AUTH_FROM_EMAIL must be a valid sender on a Resend-verified domain."
}

$templatePath = Join-Path $repositoryRoot "supabase\templates\fixnote-otp.html"
$template = Get-Content -Raw -Encoding UTF8 -LiteralPath $templatePath
Add-Type -AssemblyName System.Web.Extensions
$serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$serializer.MaxJsonLength = 1048576
$configUri = "https://api.supabase.com/v1/projects/$ProjectRef/config/auth"
$headers = @{
  Authorization = "Bearer $AccessToken"
  "Content-Type" = "application/json"
}

$currentConfig = Invoke-RestMethod `
  -Method Get `
  -Uri $configUri `
  -Headers $headers

if (
  [string]::IsNullOrWhiteSpace($ResendApiKey) -and
  (
    [string]$currentConfig.smtp_host -ne "smtp.resend.com" -or
    [string]$currentConfig.smtp_user -ne "resend"
  )
) {
  throw "RESEND_API_KEY is required because Resend SMTP is not configured yet."
}

$settings = @{
  external_email_enabled = $true
  mailer_autoconfirm = $false
  mailer_otp_length = 6
  mailer_secure_email_change_enabled = $true
  rate_limit_email_sent = 30
  smtp_admin_email = $FromEmail
  smtp_sender_name = $SenderName
  mailer_subjects_confirmation = "Your FixNote code"
  mailer_subjects_magic_link = "Your FixNote code"
  mailer_templates_confirmation_content = [string]$template
  mailer_templates_magic_link_content = [string]$template
}

if (-not [string]::IsNullOrWhiteSpace($ResendApiKey)) {
  $settings.smtp_host = "smtp.resend.com"
  $settings.smtp_port = "587"
  $settings.smtp_user = "resend"
  $settings.smtp_pass = $ResendApiKey
}

$payload = $serializer.Serialize($settings)

Invoke-RestMethod `
  -Method Patch `
  -Uri $configUri `
  -Headers $headers `
  -Body $payload | Out-Null

$config = Invoke-RestMethod `
  -Method Get `
  -Uri $configUri `
  -Headers $headers

$expected = @{
  smtp_admin_email = $FromEmail
  smtp_host = "smtp.resend.com"
  smtp_port = "587"
  smtp_user = "resend"
  smtp_sender_name = $SenderName
  mailer_otp_length = "6"
  rate_limit_email_sent = "30"
  mailer_subjects_confirmation = "Your FixNote code"
  mailer_subjects_magic_link = "Your FixNote code"
}

foreach ($entry in $expected.GetEnumerator()) {
  if ([string]$config.($entry.Key) -ne [string]$entry.Value) {
    throw "Supabase verification failed for $($entry.Key)."
  }
}

if (
  [string]$config.mailer_templates_confirmation_content -notmatch "\{\{\s*\.Token\s*\}\}" -or
  [string]$config.mailer_templates_magic_link_content -notmatch "\{\{\s*\.Token\s*\}\}"
) {
  throw "Supabase verification failed for the OTP email template."
}

Write-Output "Resend SMTP and FixNote OTP email templates are configured for project $ProjectRef."
