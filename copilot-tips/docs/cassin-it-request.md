# Request for Cassin IT: allow the weekly Copilot tip to reach all staff

Fortify Cyber sends Cassin a short **Friday Copilot Tip** email every week. To send it to all staff, the email needs to go to Cassin's all-staff distribution list. That list blocks mail from outside the firm by default, so it needs the one-time changes below. They take about 10 minutes in Exchange Online PowerShell.

Throughout this page:

| Placeholder | Replace with |
|---|---|
| `LIST` | Cassin's all-staff list address, e.g. `allstaff@cassinllp.com` |
| `SENDER` | Fortify's sending address: `copilot-tips@fortifycyber.com` (or `mgalbo@fortifycyber.com` until that mailbox exists) |

```powershell
Connect-ExchangeOnline
```

## 1. Let the list accept the email from Fortify
Allow outside senders on the list, then add a mail flow rule that rejects every outside sender **except** Fortify's address. The list stays closed to everyone else on the internet.

```powershell
# Distribution list or mail-enabled security group:
Set-DistributionGroup -Identity "LIST" -RequireSenderAuthenticationEnabled $false
# Microsoft 365 group instead:
# Set-UnifiedGroup -Identity "LIST" -RequireSenderAuthenticationEnabled $false

New-TransportRule -Name "All-staff list: only Fortify Copilot tips from outside" `
  -SentTo "LIST" -FromScope NotInOrganization -ExceptIfFrom "SENDER" `
  -RejectMessageReasonText "This list does not accept email from outside the firm." `
  -RejectMessageEnhancedStatusCode "5.7.1"
```

## 2. Remove the "External" banner for this sender (recommended)
Without this, every tip shows Outlook's yellow external-sender warning. The tips contain links, so the warning works against your phishing training. This removes the banner for Fortify's sending address only.

```powershell
Set-ExternalInOutlook -AllowList @{Add="SENDER"}
```

## 3. Microsoft 365 groups only: deliver to people's inboxes
If `LIST` is a Microsoft 365 group (for example, one created with a Team), mail stays in the group mailbox unless members are subscribed. Skip this step for a regular distribution list.

```powershell
Set-UnifiedGroup -Identity "LIST" -AutoSubscribeNewMembers:$true
Get-UnifiedGroupLinks -Identity "LIST" -LinkType Members |
  ForEach-Object { Add-UnifiedGroupLinks -Identity "LIST" -LinkType Subscribers -Links $_.PrimarySmtpAddress }
```

## 4. Tell Fortify when it's done
Send Fortify the list address. Fortify will send one test to the list and ask you to confirm it arrived in the Inbox (not Junk or quarantine), with no External banner.

**To undo:** `Remove-TransportRule "All-staff list: only Fortify Copilot tips from outside"`, then set `-RequireSenderAuthenticationEnabled $true` on the list again.
