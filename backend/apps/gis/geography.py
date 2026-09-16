import json
from pathlib import Path

_DATA_FILE = Path(__file__).resolve().parent / "geography_data.json"
_GEO_DATA = None

def _get_data():
    global _GEO_DATA
    if _GEO_DATA is None:
        if _DATA_FILE.exists():
            _GEO_DATA = json.loads(_DATA_FILE.read_text())
        else:
            _GEO_DATA = {
                "NORTH_EASTERN_REGION": {},
                "NER_STATES": {},
                "NER_DISTRICTS": {},
                "NER_MONITORED_ZONES": {},
                "NER_CITIES": [],
            }
    return _GEO_DATA

def get_region():
    return _get_data().get("NORTH_EASTERN_REGION", {})

def get_all_states():
    return list(_get_data().get("NER_STATES", {}).values())

def get_state_by_id(state_id: str):
    return _get_data().get("NER_STATES", {}).get(state_id)

def get_districts_by_state(state_id: str):
    state = get_state_by_id(state_id)
    if not state:
        # Check by state code
        for s in get_all_states():
            if s.get("code", "").lower() == state_id.lower():
                state = s
                break
    if not state:
        return []
    district_ids = state.get("districtIds", [])
    all_districts = _get_data().get("NER_DISTRICTS", {})
    return [all_districts[d_id] for d_id in district_ids if d_id in all_districts]

def get_district_by_id(district_id: str):
    return _get_data().get("NER_DISTRICTS", {}).get(district_id)

def get_all_zones():
    return list(_get_data().get("NER_MONITORED_ZONES", {}).values())

def get_zones_by_district(district_id: str):
    dist = get_district_by_id(district_id)
    all_zones = _get_data().get("NER_MONITORED_ZONES", {})
    if dist:
        zone_ids = dist.get("zoneIds", [])
        return [all_zones[str(zid)] for zid in zone_ids if str(zid) in all_zones]
    # Check by district name
    d_name = district_id.lower()
    return [z for z in all_zones.values() if z.get("district", "").lower() == d_name]

def get_zones_by_state(state_id: str):
    districts = get_districts_by_state(state_id)
    zone_ids = []
    for d in districts:
        zone_ids.extend(d.get("zoneIds", []))
    all_zones = _get_data().get("NER_MONITORED_ZONES", {})
    return [all_zones[str(zid)] for zid in zone_ids if str(zid) in all_zones]

def get_complete_hierarchy():
    region = get_region()
    states_out = []
    all_districts = _get_data().get("NER_DISTRICTS", {})
    all_zones = _get_data().get("NER_MONITORED_ZONES", {})

    for state in get_all_states():
        dist_list = []
        for d_id in state.get("districtIds", []):
            dist = all_districts.get(d_id)
            if dist:
                zones = [all_zones[str(zid)] for zid in dist.get("zoneIds", []) if str(zid) in all_zones]
                dist_list.append({**dist, "zones": zones})
        states_out.append({**state, "districts": dist_list})

    return {
        "region": region,
        "states": states_out,
        "summary": {
            "totalStates": len(states_out),
            "totalDistricts": len(all_districts),
            "totalMonitoredZones": len(all_zones),
        },
    }

def get_all_cities():
    return _get_data().get("NER_CITIES", [])

def get_city_by_id(city_id: str):
    for c in get_all_cities():
        if c.get("id") == city_id:
            return c
    return None

def search_geography(q: str):
    if not q or not q.strip():
        return []
    q = q.lower().strip()
    results = []

    # States
    for state in get_all_states():
        if q in state.get("name", "").lower() or q in state.get("code", "").lower():
            results.append({
                "type": "state",
                "id": state.get("id"),
                "name": state.get("name"),
                "centroid": state.get("centroid"),
                "description": f"State ({state.get('districtCount')} districts)",
            })

    # Cities
    for city in get_all_cities():
        c_name = city.get("name", "").lower()
        d_name = city.get("districtName", "").lower()
        s_name = city.get("stateName", "").lower()
        if q in c_name or q in f"{c_name} {d_name}" or q in f"{c_name} {s_name}":
            zone_ids = city.get("zoneIds", [])
            active_zone = zone_ids[0] if zone_ids else None
            c_type = city.get("type", "city")
            t_label = "City" if c_type == "city" else ("Town" if c_type == "town" else "Locality")
            results.append({
                "type": c_type,
                "id": city.get("id"),
                "name": city.get("name"),
                "stateName": city.get("stateName"),
                "districtName": city.get("districtName"),
                "centroid": city.get("centroid"),
                "zoneId": active_zone,
                "description": f"{t_label} · {city.get('districtName')}, {city.get('stateName')}{f' (Zone {active_zone} active)' if active_zone else ''}",
            })

    # Districts
    for dist in _get_data().get("NER_DISTRICTS", {}).values():
        d_name = dist.get("name", "").lower()
        if q in d_name or q in f"{d_name} district":
            zone_ids = dist.get("zoneIds", [])
            active_zone = zone_ids[0] if zone_ids else None
            results.append({
                "type": "district",
                "id": dist.get("id"),
                "name": dist.get("name"),
                "stateName": dist.get("stateName"),
                "centroid": dist.get("centroid"),
                "zoneId": active_zone,
                "description": f"District · {dist.get('stateName')}{f' ({len(zone_ids)} telemetry station)' if zone_ids else ' (Regional coverage)'}",
            })

    # Zones
    for zone in get_all_zones():
        z_name = zone.get("name", "").lower()
        zid = str(zone.get("id"))
        if q in z_name or f"zone {zid}" in q or f"zone-{zid}" in q or q == zid:
            results.append({
                "type": "zone",
                "id": zone.get("id"),
                "name": zone.get("name"),
                "stateName": zone.get("state"),
                "districtName": zone.get("district"),
                "centroid": [zone.get("centroid_lat"), zone.get("centroid_lng")],
                "zoneId": zone.get("id"),
                "description": f"Monitored Zone #{zid} · {zone.get('district')}, {zone.get('state')}",
            })

    sorted_results = sorted(results, key=lambda x: (not x.get("name", "").lower().startswith(q), x.get("name", "")))
    return sorted_results[:30]
