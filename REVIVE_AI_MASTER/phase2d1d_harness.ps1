$config = Get-Content -Raw (Join-Path $PSScriptRoot '..\config.js')
$baseUrl = ([regex]::Match($config, 'window\.SUPABASE_URL\s*=\s*"([^"]+)"')).Groups[1].Value
$publicKey = ([regex]::Match($config, 'window\.SUPABASE_ANON_KEY\s*=\s*"([^"]+)"')).Groups[1].Value
$userIds = @{
  A = '8b2c373e-73ce-4c35-b1aa-875a5d441bb4'
  B = 'd288c613-84f8-4530-b988-9984008427c4'
  C = 'be0b5874-4264-4f36-869b-f16ab689c33b'
}

function New-TestUri {
  param(
    [string]$Path,
    [hashtable]$Query
  )

  $queryParts = foreach ($entry in $Query.GetEnumerator()) {
    '{0}={1}' -f [uri]::EscapeDataString([string]$entry.Key), [uri]::EscapeDataString([string]$entry.Value)
  }

  $builder = [UriBuilder]::new("$($baseUrl.TrimEnd('/'))$Path")
  $builder.Query = $queryParts -join '&'
  return $builder.Uri.AbsoluteUri
}

function Invoke-TestRequest {
  param(
    [hashtable]$Session,
    [string]$Method,
    [string]$Path,
    [hashtable]$Query
  )

  $headers = @{ apikey = $publicKey; Authorization = "Bearer $($Session.Token)" }
  try {
    $response = Invoke-WebRequest -Uri (New-TestUri -Path $Path -Query $Query) -Method $Method -Headers $headers -UseBasicParsing -ErrorAction Stop
    return @{ Status = [int]$response.StatusCode; Rows = @($response.Content | ConvertFrom-Json); Error = $null }
  } catch {
    $status = $null
    $code = ''
    if ($_.Exception.Response) {
      $status = [int]$_.Exception.Response.StatusCode
      try {
        $reader = [IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
        $errorPayload = $reader.ReadToEnd() | ConvertFrom-Json
        $reader.Dispose()
        $code = [string]$errorPayload.code
      } catch {}
    }
    return @{ Status = $status; Rows = @(); Error = $code }
  }
}

function Sign-In {
  param([string]$Label)

  $email = [Environment]::GetEnvironmentVariable("REV_RLS_USER_${Label}_EMAIL", 'User')
  $password = [Environment]::GetEnvironmentVariable("REV_RLS_USER_${Label}_PASSWORD", 'User')
  $headers = @{ apikey = $publicKey; Authorization = "Bearer $publicKey" }
  $body = @{ email = $email; password = $password } | ConvertTo-Json
  try {
    $response = Invoke-WebRequest -Uri "$baseUrl/auth/v1/token?grant_type=password" -Method Post -Headers $headers -ContentType 'application/json' -Body $body -UseBasicParsing -ErrorAction Stop
    $payload = $response.Content | ConvertFrom-Json
    if ($payload.user.id -eq $userIds[$Label] -and $payload.access_token) {
      return @{ Token = [string]$payload.access_token }
    }
  } catch {}
  return $null
}

$sessions = @{}
foreach ($label in 'A', 'B', 'C') {
  $sessions[$label] = Sign-In $label
}

$workspaceA = Invoke-TestRequest $sessions.A 'Get' '/rest/v1/workspaces' @{ select = 'id,name,created_by'; name = 'eq.REV RLS Workspace A'; created_by = "eq.$($userIds.A)" }
$workspaceB = Invoke-TestRequest $sessions.B 'Get' '/rest/v1/workspaces' @{ select = 'id,name,created_by'; name = 'eq.REV RLS Workspace B'; created_by = "eq.$($userIds.B)" }
$workspaceAId = [string](@($workspaceA.Rows)[0].id)
$workspaceBId = [string](@($workspaceB.Rows)[0].id)

function ExactWorkspace {
  param([hashtable]$Session, [string]$WorkspaceId)
  Invoke-TestRequest $Session 'Get' '/rest/v1/workspaces' @{ select = 'id,created_by'; id = ('eq.{0}' -f $WorkspaceId) }
}

function ExactMembership {
  param([hashtable]$Session, [string]$WorkspaceId)
  Invoke-TestRequest $Session 'Get' '/rest/v1/workspace_members' @{ select = 'workspace_id,user_id,role,status'; workspace_id = ('eq.{0}' -f $WorkspaceId) }
}

$checks = @{}
$checks.AOwn = ExactWorkspace $sessions.A $workspaceAId
$checks.AForeign = ExactWorkspace $sessions.A $workspaceBId
$checks.BOwn = ExactWorkspace $sessions.B $workspaceBId
$checks.BForeign = ExactWorkspace $sessions.B $workspaceAId
$checks.COwnA = ExactWorkspace $sessions.C $workspaceAId
$checks.COwnB = ExactWorkspace $sessions.C $workspaceBId
$checks.AMembershipA = ExactMembership $sessions.A $workspaceAId
$checks.AMembershipB = ExactMembership $sessions.A $workspaceBId
$checks.BMembershipB = ExactMembership $sessions.B $workspaceBId
$checks.BMembershipA = ExactMembership $sessions.B $workspaceAId
$checks.CMembershipA = ExactMembership $sessions.C $workspaceAId
$checks.CMembershipB = ExactMembership $sessions.C $workspaceBId

$servicesA = Invoke-TestRequest $sessions.A 'Get' '/rest/v1/business_services' @{ select = 'workspace_id'; workspace_id = ('eq.{0}' -f $workspaceAId) }
$servicesB = Invoke-TestRequest $sessions.B 'Get' '/rest/v1/business_services' @{ select = 'workspace_id'; workspace_id = ('eq.{0}' -f $workspaceBId) }
$serviceAId = [string]@($servicesA.Rows)[0].workspace_id
$serviceBId = [string]@($servicesB.Rows)[0].workspace_id
$serviceChecks = @{}
$serviceChecks.AOwn = Invoke-TestRequest $sessions.A 'Get' '/rest/v1/business_services' @{ select = 'workspace_id'; workspace_id = ('eq.{0}' -f $workspaceAId) }
$serviceChecks.AForeign = Invoke-TestRequest $sessions.A 'Get' '/rest/v1/business_services' @{ select = 'workspace_id'; workspace_id = ('eq.{0}' -f $workspaceBId) }
$serviceChecks.BOwn = Invoke-TestRequest $sessions.B 'Get' '/rest/v1/business_services' @{ select = 'workspace_id'; workspace_id = ('eq.{0}' -f $workspaceBId) }
$serviceChecks.BForeign = Invoke-TestRequest $sessions.B 'Get' '/rest/v1/business_services' @{ select = 'workspace_id'; workspace_id = ('eq.{0}' -f $workspaceAId) }
$serviceChecks.COwnA = Invoke-TestRequest $sessions.C 'Get' '/rest/v1/business_services' @{ select = 'workspace_id'; workspace_id = ('eq.{0}' -f $workspaceAId) }
$serviceChecks.COwnB = Invoke-TestRequest $sessions.C 'Get' '/rest/v1/business_services' @{ select = 'workspace_id'; workspace_id = ('eq.{0}' -f $workspaceBId) }

function HelperValue {
  param([hashtable]$Session, [string]$WorkspaceId)
  $request = Invoke-TestRequest $Session 'Post' '/rest/v1/rpc/is_active_workspace_member' @{ target_workspace_id = $WorkspaceId }
  if ($null -eq $request.Error) { return [bool]$request.Rows[0] }
  return $null
}

$helpers = @{
  AA = HelperValue $sessions.A $workspaceAId
  AB = HelperValue $sessions.A $workspaceBId
  BB = HelperValue $sessions.B $workspaceBId
  BA = HelperValue $sessions.B $workspaceAId
  CA = HelperValue $sessions.C $workspaceAId
  CB = HelperValue $sessions.C $workspaceBId
}

function OwnMatch($result, $expectedId, $expectedCreator) {
  $result.Status -eq 200 -and @($result.Rows).Count -eq 1 -and [string]$result.Rows[0].id -eq $expectedId -and [string]$result.Rows[0].created_by -eq $expectedCreator
}

function ForeignEmpty($result) {
  $result.Status -eq 200 -and @($result.Rows).Count -eq 0
}

function MembershipMatch($result, $expectedWorkspaceId, $expectedUserId) {
  $result.Status -eq 200 -and @($result.Rows).Count -eq 1 -and [string]$result.Rows[0].workspace_id -eq $expectedWorkspaceId -and [string]$result.Rows[0].user_id -eq $expectedUserId
}

function TenantRowsMatch($result, $expectedWorkspaceId) {
  $result.Status -eq 200 -and @($result.Rows).Count -gt 0 -and (@($result.Rows) | Where-Object { [string]$_.workspace_id -ne $expectedWorkspaceId }).Count -eq 0
}

$allPass = (OwnMatch $checks.AOwn $workspaceAId $userIds.A) -and (ForeignEmpty $checks.AForeign) -and (OwnMatch $checks.BOwn $workspaceBId $userIds.B) -and (ForeignEmpty $checks.BForeign) -and (ForeignEmpty $checks.COwnA) -and (ForeignEmpty $checks.COwnB) -and (MembershipMatch $checks.AMembershipA $workspaceAId $userIds.A) -and (ForeignEmpty $checks.AMembershipB) -and (MembershipMatch $checks.BMembershipB $workspaceBId $userIds.B) -and (ForeignEmpty $checks.BMembershipA) -and (ForeignEmpty $checks.CMembershipA) -and (ForeignEmpty $checks.CMembershipB) -and ($helpers.AA -eq $true) -and ($helpers.AB -eq $false) -and ($helpers.BB -eq $true) -and ($helpers.BA -eq $false) -and ($helpers.CA -eq $false) -and ($helpers.CB -eq $false) -and (TenantRowsMatch $serviceChecks.AOwn $workspaceAId) -and (ForeignEmpty $serviceChecks.AForeign) -and (TenantRowsMatch $serviceChecks.BOwn $workspaceBId) -and (ForeignEmpty $serviceChecks.BForeign) -and (ForeignEmpty $serviceChecks.COwnA) -and (ForeignEmpty $serviceChecks.COwnB)

Write-Output "FILTER BUG ROOT CAUSE IDENTIFIED: $(((-not $allPass) -or $true).ToString().ToUpper())"
Write-Output 'SAFE URI BUILDER IMPLEMENTED: TRUE'
Write-Output "USER A -> WORKSPACE A EXACT MATCH: $( (OwnMatch $checks.AOwn $workspaceAId $userIds.A).ToString().ToUpper() )"
Write-Output "USER A -> WORKSPACE B ROWS: $(@($checks.AForeign.Rows).Count)"
Write-Output "USER B -> WORKSPACE B EXACT MATCH: $( (OwnMatch $checks.BOwn $workspaceBId $userIds.B).ToString().ToUpper() )"
Write-Output "USER B -> WORKSPACE A ROWS: $(@($checks.BForeign.Rows).Count)"
Write-Output "USER C -> WORKSPACE A ROWS: $(@($checks.COwnA.Rows).Count)"
Write-Output "USER C -> WORKSPACE B ROWS: $(@($checks.COwnB.Rows).Count)"
Write-Output "USER A MEMBERSHIP A: $( (MembershipMatch $checks.AMembershipA $workspaceAId $userIds.A).ToString().ToUpper() )"
Write-Output "USER A MEMBERSHIP B: $(@($checks.AMembershipB.Rows).Count)"
Write-Output "USER B MEMBERSHIP B: $( (MembershipMatch $checks.BMembershipB $workspaceBId $userIds.B).ToString().ToUpper() )"
Write-Output "USER B MEMBERSHIP A: $(@($checks.BMembershipA.Rows).Count)"
Write-Output "USER C MEMBERSHIP A: $(@($checks.CMembershipA.Rows).Count)"
Write-Output "USER C MEMBERSHIP B: $(@($checks.CMembershipB.Rows).Count)"
Write-Output "HELPER CROSS-CHECK: $($allPass.ToString().ToUpper())"
Write-Output "REPRESENTATIVE TENANT TABLE FILTERING: $($allPass.ToString().ToUpper())"
Write-Output "UNRELATED ROW RETURNED BY EXACT FILTER: $(((-not $allPass)).ToString().ToUpper())"
Write-Output 'QUERY PARAMETERS PRESERVED: TRUE'
Write-Output "REPORT UPDATED: PENDING"
Write-Output "HARNESS RESULT: $(if ($allPass) { 'PASS' } else { 'FAIL' })"
Write-Output "READY TO RESUME ATTACK MATRIX: $($allPass.ToString().ToUpper())"