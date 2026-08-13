param(
  [string]$AdminUser = 'billing@iacy.com',
  [string]$SenderMailbox = 'billing@iacy.com',
  [string]$ApplicationId = '01b20a88-61dd-4493-8382-ff510c98f629',
  [string]$ServicePrincipalObjectId = '063906f3-88e8-4789-b6ca-6fa14fae90c5'
)

$ErrorActionPreference = 'Stop'
$displayName = 'IACy Accounting Billing'
$scopeName = 'IACy Billing Mailbox Only'
$assignmentName = 'IACy Accounting Billing Mail.Send'

Import-Module ExchangeOnlineManagement
Connect-ExchangeOnline -UserPrincipalName $AdminUser -Device -ShowBanner:$false

try {
  $mailbox = Get-EXOMailbox -Identity $SenderMailbox -Properties Alias
  $alias = $mailbox.Alias

  if (-not (Get-ServicePrincipal -Identity $displayName -ErrorAction SilentlyContinue)) {
    New-ServicePrincipal -AppId $ApplicationId -ObjectId $ServicePrincipalObjectId -DisplayName $displayName | Out-Null
  }

  if (-not (Get-ManagementScope -Identity $scopeName -ErrorAction SilentlyContinue)) {
    New-ManagementScope -Name $scopeName -RecipientRestrictionFilter "Alias -eq '$alias'" | Out-Null
  }

  $recipientFilter = (Get-ManagementScope -Identity $scopeName).RecipientFilter
  $matches = @(Get-Recipient -RecipientPreviewFilter $recipientFilter)
  if ($matches.Count -ne 1 -or $matches[0].PrimarySmtpAddress -ne $SenderMailbox) {
    throw "Mailbox scope must resolve exclusively to $SenderMailbox"
  }

  if (-not (Get-ManagementRoleAssignment -Identity $assignmentName -ErrorAction SilentlyContinue)) {
    New-ManagementRoleAssignment -Name $assignmentName -App $ServicePrincipalObjectId -Role 'Application Mail.Send' -CustomResourceScope $scopeName | Out-Null
  }

  Test-ServicePrincipalAuthorization -Identity $ServicePrincipalObjectId -Resource $SenderMailbox |
    Select-Object RoleName, ScopeType, InScope |
    ConvertTo-Json -Compress
}
finally {
  Disconnect-ExchangeOnline -Confirm:$false
}
