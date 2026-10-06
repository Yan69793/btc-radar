$ErrorActionPreference = "Stop"
$root = "E:\Diretorio\Claude\PROJETOS\Btc-radar\btc-radar"
$outDir = Join-Path $root "artifacts\monitoring"
$historyPath = Join-Path $outDir "production-health.jsonl"
$statePath = Join-Path $outDir "state.json"
$alertPath = Join-Path $outDir "last-material-alert.json"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function Probe([string]$Name,[string]$Url,[switch]$Json) {
  $sw=[Diagnostics.Stopwatch]::StartNew()
  try {
    $r=Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 25
    $sw.Stop()
    $body=$null
    if($Json){ try { $body=$r.Content | ConvertFrom-Json } catch {} }
    return [pscustomobject]@{name=$Name;url=$Url;http=[int]$r.StatusCode;latency_ms=$sw.ElapsedMilliseconds;ok=([int]$r.StatusCode -eq 200);body=$body;error=$null}
  } catch {
    $sw.Stop()
    $http=0
    if($_.Exception.Response){ try {$http=[int]$_.Exception.Response.StatusCode.value__} catch {} }
    return [pscustomobject]@{name=$Name;url=$Url;http=$http;latency_ms=$sw.ElapsedMilliseconds;ok=$false;body=$null;error=$_.Exception.Message}
  }
}

$probes=@(
  (Probe "multi_assets" "https://multi-assets.com/"),
  (Probe "btc_intelligence" "https://multi-assets.com/api/intelligence/btc" -Json),
  (Probe "btc_panel" "https://btc-radar.pages.dev/painel/"),
  (Probe "btc_health" "https://btc-radar.prospects-intel.workers.dev/api/health" -Json),
  (Probe "macro_context" "https://btc-radar.prospects-intel.workers.dev/api/macro-context" -Json),
  (Probe "macro_upstream" "https://multi-assets.com/assets/macro.php" -Json)
)

$now=[DateTimeOffset]::Now
$material=New-Object System.Collections.Generic.List[string]
$predictive=New-Object System.Collections.Generic.List[string]
foreach($p in $probes){ if(-not $p.ok){$material.Add("$($p.name): HTTP $($p.http) $($p.error)")}}

$intel=$probes | Where-Object name -eq "btc_intelligence"
if($intel.body){
  if($intel.body.quality.state -ne "good" -or [int]$intel.body.quality.score -lt 85){$material.Add("btc_intelligence quality=$($intel.body.quality.score)/$($intel.body.quality.state)")}
  if([int]$intel.body.data.service.last_cron_errors -gt 0){$material.Add("last_cron_errors=$($intel.body.data.service.last_cron_errors)")}
}

$health=$probes | Where-Object name -eq "btc_health"
if($health.body){
  if([int]$health.body.freshness.last_cron_errors -gt 0){$material.Add("health last_cron_errors=$($health.body.freshness.last_cron_errors)")}
  $cron=[DateTimeOffset]::Parse([string]$health.body.freshness.last_cron_at,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::RoundtripKind)
  $cronAge=($now-$cron).TotalMinutes
  if($cronAge -gt 95){$material.Add(("last_cron_at delayed {0:N1}m" -f $cronAge))}
  elseif($cronAge -gt 75){$predictive.Add(("cron approaching delay threshold {0:N1}m" -f $cronAge))}
}

$macro=$probes | Where-Object name -eq "macro_context"
if($macro.body){
  $fallback=[bool]$macro.body.fallback.active
  if($fallback){$predictive.Add("macro_context serving last-good fallback")}
  elseif($macro.body.quality.state -ne "good" -or [int]$macro.body.quality.score -lt 85){$material.Add("macro_context quality=$($macro.body.quality.score)/$($macro.body.quality.state)")}
  foreach($s in @($macro.body.sources)){ if($s.state -in @("stale","expired","missing")){ if($s.name -eq "macro"){$material.Add("macro source $($s.name)=$($s.state)")}else{$predictive.Add("macro-context dependency $($s.name)=$($s.state)")}} }
}

$up=$probes | Where-Object name -eq "macro_upstream"
if($up.latency_ms -gt 12000){$material.Add("macro_upstream latency=$($up.latency_ms)ms")}
elseif($up.latency_ms -gt 6000){$predictive.Add("macro_upstream latency elevated=$($up.latency_ms)ms")}

$record=[ordered]@{
  ts=$now.ToString("o")
  probes=@($probes | ForEach-Object {[ordered]@{name=$_.name;http=$_.http;latency_ms=$_.latency_ms;ok=$_.ok;error=$_.error}})
  material=@($material)
  predictive=@($predictive)
}
($record | ConvertTo-Json -Depth 7 -Compress) | Add-Content -Path $historyPath -Encoding UTF8

$recent=@()
if(Test-Path $historyPath){
  $recent=Get-Content $historyPath -Tail 12 | ForEach-Object {try{$_|ConvertFrom-Json}catch{}}
}
$lat=@($recent | ForEach-Object {($_.probes|Where-Object name -eq "macro_upstream").latency_ms} | Where-Object {$_ -ne $null} | Sort-Object)
if($lat.Count -ge 4){
  $idx=[Math]::Min($lat.Count-1,[Math]::Ceiling($lat.Count*0.95)-1)
  $p95=[double]$lat[$idx]
  if($p95 -gt 6000){$predictive.Add(("rolling macro_upstream p95={0:N0}ms" -f $p95))}
}
$fails=@($recent | Where-Object {($_.probes|Where-Object name -eq "macro_upstream").ok -eq $false}).Count
if($fails -ge 2){$predictive.Add("macro_upstream failures in rolling window=$fails")}

$state=[ordered]@{updated_at=$now.ToString("o");status=if($material.Count){"material_anomaly"}elseif($predictive.Count){"predictive_warning"}else{"healthy"};material=@($material);predictive=@($predictive)}
$state | ConvertTo-Json -Depth 6 | Set-Content -Path $statePath -Encoding UTF8
if($material.Count){$state | ConvertTo-Json -Depth 6 | Set-Content -Path $alertPath -Encoding UTF8}
exit $(if($material.Count){2}else{0})
