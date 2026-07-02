#!/bin/sh
# Bereitet den OSRM-Graphen einmalig auf (MLD-Pipeline) und startet den Routing-Server.
# Stempeldatei .prepared statt Pruefung interner OSRM-Artefakte (deren Namen variieren je Version).
# --max-table-size 10000: Matrix-Anfragen bis 10.000 Orte (Standard waere 100 — zu klein fuer Stadtplanung).
set -e
cd /data
if [ ! -f /data/.prepared ]; then
  osrm-extract -p /opt/car.lua /data/region.osm.pbf
  osrm-partition /data/region.osrm
  osrm-customize /data/region.osrm
  touch /data/.prepared
fi
exec osrm-routed --algorithm mld --max-table-size 10000 /data/region.osrm
