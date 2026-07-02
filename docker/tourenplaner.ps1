<#
  Lokaler Tourenplaner-Stack (OSRM + VROOM) mit BENANNTEN Datensaetzen.
  Abgeleitet vom RWF-Geocoder-Skript des Kollegen — ohne Nominatim, dafuer mit VROOM.
  Beim Laden vergibst du einen Namen; darunter werden die Regionsdaten gespeichert.
  Mehrere Datensaetze moeglich; aktivieren schaltet um (einer laeuft zur Zeit).

  Beispiele:
    .\tourenplaner.ps1 importieren "Koeln Regbez" koeln          # Region laden + speichern
    .\tourenplaner.ps1 bbox "Bonn Pilot" -Region koeln -S 50.62 -W 6.99 -N 50.79 -E 7.22
    .\tourenplaner.ps1 bbox "Irgendwo" -S 51.1 -W 7.5 -N 51.4 -E 7.9   # Bundesland-Automatik
    .\tourenplaner.ps1 liste
    .\tourenplaner.ps1 aktivieren "Bonn Pilot"
    .\tourenplaner.ps1 status
    .\tourenplaner.ps1 stop
    .\tourenplaner.ps1 loeschen "Koeln Regbez"

  Endpunkte (wenn aktiv):
    Routing/Matrix:  http://localhost:5010/osrm/route/v1/driving/...  bzw. /osrm/table/v1/driving/...
    Optimierung:     POST http://localhost:5010/vroom/   (JSON: jobs + vehicles)
#>
param(
  [Parameter(Mandatory = $true)][ValidateSet('importieren', 'bbox', 'aktivieren', 'liste', 'status', 'stop', 'loeschen')]
  [string]$Aktion,
  [string]$Name,
  [string]$Region,
  [double]$S, [double]$W, [double]$N, [double]$E
)

# Continue (nicht Stop): docker schreibt Fortschritt nach stderr — das darf das Skript nicht abbrechen.
$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot
$metaPfad = Join-Path $PSScriptRoot 'tourenplaner-datasets.json'
$composeDatei = 'tourenplaner-compose.yml'

$basis = 'https://download.geofabrik.de/europe/germany'
$regionen = @{
  'baden-wuerttemberg'     = "$basis/baden-wuerttemberg-latest.osm.pbf"
  'stuttgart'              = "$basis/baden-wuerttemberg/stuttgart-regbez-latest.osm.pbf"
  'karlsruhe'              = "$basis/baden-wuerttemberg/karlsruhe-regbez-latest.osm.pbf"
  'freiburg'               = "$basis/baden-wuerttemberg/freiburg-regbez-latest.osm.pbf"
  'tuebingen'              = "$basis/baden-wuerttemberg/tuebingen-regbez-latest.osm.pbf"
  'bayern'                 = "$basis/bayern-latest.osm.pbf"
  'berlin'                 = "$basis/berlin-latest.osm.pbf"
  'brandenburg'            = "$basis/brandenburg-latest.osm.pbf"
  'bremen'                 = "$basis/bremen-latest.osm.pbf"
  'hamburg'                = "$basis/hamburg-latest.osm.pbf"
  'hessen'                 = "$basis/hessen-latest.osm.pbf"
  'mecklenburg-vorpommern' = "$basis/mecklenburg-vorpommern-latest.osm.pbf"
  'niedersachsen'          = "$basis/niedersachsen-latest.osm.pbf"
  'nordrhein-westfalen'    = "$basis/nordrhein-westfalen-latest.osm.pbf"
  'nrw'                    = "$basis/nordrhein-westfalen-latest.osm.pbf"
  'arnsberg'               = "$basis/nordrhein-westfalen/arnsberg-regbez-latest.osm.pbf"
  'detmold'                = "$basis/nordrhein-westfalen/detmold-regbez-latest.osm.pbf"
  'duesseldorf'            = "$basis/nordrhein-westfalen/duesseldorf-regbez-latest.osm.pbf"
  'koeln'                  = "$basis/nordrhein-westfalen/koeln-regbez-latest.osm.pbf"
  'muenster'               = "$basis/nordrhein-westfalen/muenster-regbez-latest.osm.pbf"
  'rheinland-pfalz'        = "$basis/rheinland-pfalz-latest.osm.pbf"
  'saarland'               = "$basis/saarland-latest.osm.pbf"
  'sachsen'                = "$basis/sachsen-latest.osm.pbf"
  'sachsen-anhalt'         = "$basis/sachsen-anhalt-latest.osm.pbf"
  'schleswig-holstein'     = "$basis/schleswig-holstein-latest.osm.pbf"
  'thueringen'             = "$basis/thueringen-latest.osm.pbf"
  'deutschland'            = 'https://download.geofabrik.de/europe/germany-latest.osm.pbf'
}

function Lade-Meta {
  if (Test-Path $metaPfad) { @(Get-Content $metaPfad -Raw | ConvertFrom-Json) } else { @() }
}
function Speichere-Meta($daten) {
  ($daten | ConvertTo-Json -Depth 5) | Set-Content $metaPfad -Encoding utf8
}
function Slug($s) {
  ($s.ToLower() -replace '[^a-z0-9]+', '-').Trim('-')
}
function Osrm-Von($name) { 'bw-tp-osrm-' + (Slug $name) }
function Region-Von($name) { 'bw-tp-region-' + (Slug $name) }
function Compose-Up {
  docker compose -f $composeDatei up -d --force-recreate
}
function Compose-Down {
  docker compose -f $composeDatei down 2>$null
}

# Bundeslaender mit grober Bounding-Box (s,w,n,e) fuer die Rechteck-Automatik:
# es wird das kleinste Bundesland gewaehlt, das das Rechteck vollstaendig enthaelt.
# (Praeziser: bbox mit explizitem -Region <key>, dann entfaellt das Raten.)
$laender = @(
  @{ key = 'baden-wuerttemberg';     s = 47.5; w = 7.5;  n = 49.8; e = 10.5 }
  @{ key = 'bayern';                 s = 47.2; w = 8.9;  n = 50.6; e = 13.9 }
  @{ key = 'berlin';                 s = 52.3; w = 13.0; n = 52.7; e = 13.8 }
  @{ key = 'brandenburg';            s = 51.3; w = 11.2; n = 53.6; e = 14.8 }
  @{ key = 'bremen';                 s = 53.0; w = 8.4;  n = 53.6; e = 9.0 }
  @{ key = 'hamburg';                s = 53.3; w = 9.6;  n = 53.8; e = 10.4 }
  @{ key = 'hessen';                 s = 49.3; w = 7.7;  n = 51.7; e = 10.3 }
  @{ key = 'mecklenburg-vorpommern'; s = 53.1; w = 10.5; n = 54.7; e = 14.4 }
  @{ key = 'niedersachsen';          s = 51.2; w = 6.4;  n = 53.9; e = 11.6 }
  @{ key = 'nordrhein-westfalen';    s = 50.3; w = 5.8;  n = 52.6; e = 9.5 }
  @{ key = 'rheinland-pfalz';        s = 48.9; w = 6.1;  n = 50.9; e = 8.5 }
  @{ key = 'saarland';               s = 49.1; w = 6.3;  n = 49.7; e = 7.5 }
  @{ key = 'sachsen';                s = 50.1; w = 11.8; n = 51.7; e = 15.1 }
  @{ key = 'sachsen-anhalt';         s = 50.9; w = 10.5; n = 53.1; e = 13.3 }
  @{ key = 'schleswig-holstein';     s = 53.3; w = 7.8;  n = 55.1; e = 11.4 }
  @{ key = 'thueringen';             s = 50.2; w = 9.8;  n = 51.7; e = 12.7 }
)

switch ($Aktion) {
  'importieren' {
    if (-not $Name -or -not $Region) { Write-Host "Aufruf: .\tourenplaner.ps1 importieren `"<Name>`" <Region|URL>"; exit 1 }
    $url = if ($Region -match '^https?://') { $Region } elseif ($regionen.ContainsKey($Region)) { $regionen[$Region] } else { $null }
    if (-not $url) { Write-Host "Unbekannte Region '$Region'. Bekannt: $($regionen.Keys -join ', ')"; exit 1 }
    $vol = Osrm-Von $Name
    $meta = Lade-Meta
    if ($meta | Where-Object { $_.volume -eq $vol }) {
      Write-Host "Name '$Name' existiert bereits. Erst loeschen (.\tourenplaner.ps1 loeschen `"$Name`") oder anderen Namen waehlen."; exit 1
    }
    Write-Host "Importiere Region in benannten Datensatz '$Name' (Volume $vol)..."
    Compose-Down
    $env:OSRM_VOLUME = $vol
    $env:REGION_VOLUME = Region-Von $Name
    $env:PBF_PATH = ''
    $env:PBF_URL = $url
    Compose-Up
    $meta += [pscustomobject]@{ name = $Name; volume = $vol; region = $Region; url = $url; importiert = (Get-Date).ToString('yyyy-MM-dd HH:mm') }
    Speichere-Meta $meta
    Write-Host "Gestartet. OSRM bereitet den Graphen auf (Fortschritt: docker compose -f $composeDatei logs -f osrm)."
    Write-Host "Fertig, wenn .\tourenplaner.ps1 status beide Dienste als erreichbar meldet."
  }
  'bbox' {
    # Rechteck-Auswahl: Extrakt herunterladen, mit osmium auf das Rechteck zuschneiden,
    # dann OSRM+VROOM auf die zugeschnittene Datei stellen (PBF_PATH).
    # -Region <key> waehlt den Quell-Extrakt explizit (z. B. 'koeln' fuer Bonn — kleinerer
    # Download als das Bundesland); ohne -Region greift die Bundesland-Automatik.
    if (-not $Name -or -not $PSBoundParameters.ContainsKey('S')) {
      Write-Host "Aufruf: .\tourenplaner.ps1 bbox `"<Name>`" [-Region <key>] -S <sued> -W <west> -N <nord> -E <ost>"; exit 1
    }
    $vol = Osrm-Von $Name
    $meta = Lade-Meta
    if ($meta | Where-Object { $_.volume -eq $vol }) {
      Write-Host "Name '$Name' existiert bereits. Erst loeschen oder anderen Namen waehlen."; exit 1
    }
    if ($Region) {
      if (-not $regionen.ContainsKey($Region)) { Write-Host "Unbekannte Region '$Region'. Bekannt: $($regionen.Keys -join ', ')"; exit 1 }
      $quelle = $Region
      $stateUrl = $regionen[$Region]
    } else {
      $treffer = $laender |
        Where-Object { $S -ge $_.s -and $W -ge $_.w -and $N -le $_.n -and $E -le $_.e } |
        Sort-Object { ($_.n - $_.s) * ($_.e - $_.w) } |
        Select-Object -First 1
      if (-not $treffer) {
        Write-Host "Rechteck liegt nicht innerhalb eines einzelnen Bundeslands. Kleiner ziehen oder -Region angeben (z. B. -Region deutschland)."; exit 1
      }
      $quelle = $treffer.key
      $stateUrl = $regionen[$treffer.key]
    }
    $regionVol = Region-Von $Name
    # osmium-Bbox-Reihenfolge: links,unten,rechts,oben = W,S,E,N
    $clip = "$W,$S,$E,$N"
    Write-Host "Extrakt '$quelle' wird geladen und auf das Rechteck zugeschnitten..."
    docker volume create $regionVol | Out-Null
    # --user root: das curl-Image laeuft sonst als Nicht-Root und darf nicht ins frische Volume schreiben
    docker run --rm --user root -v "${regionVol}:/region" curlimages/curl:latest -L -o /region/state.osm.pbf $stateUrl
    # iboates/osmium: osmium ist der Entrypoint (ohne fuehrendes 'osmium' aufrufen);
    # ghcr.io/osmcode/osmium-tool ist nicht oeffentlich abrufbar (denied)
    docker run --rm --user root -v "${regionVol}:/region" iboates/osmium:latest extract --bbox $clip --overwrite -o /region/region.osm.pbf /region/state.osm.pbf
    Compose-Down
    $env:OSRM_VOLUME = $vol
    $env:REGION_VOLUME = $regionVol
    $env:PBF_PATH = '/region/region.osm.pbf'
    $env:PBF_URL = ''
    Compose-Up
    $meta += [pscustomobject]@{ name = $Name; volume = $vol; region = "bbox:$quelle"; url = $stateUrl; importiert = (Get-Date).ToString('yyyy-MM-dd HH:mm') }
    Speichere-Meta $meta
    Write-Host "Gestartet. Aufbereitung laeuft im Hintergrund — pruefen mit .\tourenplaner.ps1 status"
  }
  'aktivieren' {
    if (-not $Name) { Write-Host "Aufruf: .\tourenplaner.ps1 aktivieren `"<Name>`""; exit 1 }
    $vol = Osrm-Von $Name
    $eintrag = (Lade-Meta) | Where-Object { $_.volume -eq $vol } | Select-Object -First 1
    if (-not $eintrag) { Write-Host "Kein Datensatz '$Name'. Liste: .\tourenplaner.ps1 liste"; exit 1 }
    Compose-Down
    $env:OSRM_VOLUME = $vol
    $env:REGION_VOLUME = Region-Von $Name
    if ("$($eintrag.region)" -like 'bbox:*') {
      $env:PBF_PATH = '/region/region.osm.pbf'
      $env:PBF_URL = ''
    } else {
      $env:PBF_PATH = ''
      $env:PBF_URL = $eintrag.url
    }
    Compose-Up
    Write-Host "Datensatz '$Name' wird bereitgestellt (ohne Neu-Import): http://localhost:5010"
  }
  'liste' {
    $meta = Lade-Meta
    if (-not $meta -or $meta.Count -eq 0) { Write-Host "Keine gespeicherten Datensaetze. Anlegen: .\tourenplaner.ps1 importieren `"<Name>`" <Region>" }
    else { $meta | Select-Object name, region, importiert, volume | Format-Table -AutoSize }
    Write-Host "`nLaufende Container:"; docker compose -f $composeDatei ps 2>$null
  }
  'status' {
    try {
      $o = Invoke-RestMethod -Uri 'http://localhost:5010/osrm/route/v1/driving/7.09,50.73;7.12,50.74?overview=false' -TimeoutSec 8
      Write-Host "OSRM erreichbar: code=$($o.code)"
    }
    catch { Write-Host "OSRM nicht erreichbar (Aufbereitung evtl. noch nicht fertig — docker compose -f $composeDatei logs osrm)." }
    try {
      $problem = '{"jobs":[{"id":1,"location":[7.10,50.735]},{"id":2,"location":[7.12,50.74]}],"vehicles":[{"id":1,"profile":"car","start":[7.09,50.73]}]}'
      $v = Invoke-RestMethod -Uri 'http://localhost:5010/vroom/' -Method Post -ContentType 'application/json' -Body $problem -TimeoutSec 15
      Write-Host "VROOM erreichbar: code=$($v.code) (0 = geloest), Routen=$($v.routes.Count)"
    }
    catch { Write-Host "VROOM nicht erreichbar oder Probe fehlgeschlagen: $($_.Exception.Message)" }
  }
  'stop' {
    Compose-Down
    Write-Host "Bereitstellung gestoppt. Daten bleiben erhalten (siehe .\tourenplaner.ps1 liste)."
  }
  'loeschen' {
    if (-not $Name) { Write-Host "Aufruf: .\tourenplaner.ps1 loeschen `"<Name>`""; exit 1 }
    $vol = Osrm-Von $Name
    $meta = Lade-Meta
    if (-not ($meta | Where-Object { $_.volume -eq $vol })) { Write-Host "Kein Datensatz '$Name'."; exit 1 }
    Compose-Down
    docker volume rm $vol 2>$null | Out-Null
    docker volume rm (Region-Von $Name) 2>$null | Out-Null
    Speichere-Meta @($meta | Where-Object { $_.volume -ne $vol })
    Write-Host "Datensatz '$Name' geloescht, Speicher frei."
  }
}
