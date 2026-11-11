"""The airports we track and which source reports each one.

The history key (``item_id``) is the airport's ICAO code, which never changes.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Airport:
    icao: str
    iata: str
    name: str
    city: str
    country: str
    region: str
    source: str  # "metar" or "openmeteo"
    lat: float | None = None  # Open-Meteo looks airports up by coordinates; also used to place them on the globe
    lon: float | None = None


def _us(icao, iata, name, city, lat, lon):
    # lat/lon are only used to place the airport on the website globe (METAR is looked up by code)
    return Airport(icao, iata, name, city, "United States", "North America", "metar", lat, lon)


def _intl(icao, iata, name, city, country, region, lat, lon):
    return Airport(icao, iata, name, city, country, region, "openmeteo", lat, lon)


AIRPORTS: list[Airport] = [
    # United States: reported by aviationweather.gov METAR observations
    _us("KATL", "ATL", "Hartsfield-Jackson Atlanta Intl", "Atlanta", 33.6297, -84.4422),
    _us("KLAX", "LAX", "Los Angeles Intl", "Los Angeles", 33.9382, -118.3866),
    _us("KORD", "ORD", "Chicago O'Hare Intl", "Chicago", 41.9602, -87.9316),
    _us("KDFW", "DFW", "Dallas/Fort Worth Intl", "Dallas-Fort Worth", 32.8974, -97.022),
    _us("KDEN", "DEN", "Denver Intl", "Denver", 39.8466, -104.6562),
    _us("KJFK", "JFK", "John F. Kennedy Intl", "New York", 40.6392, -73.7639),
    _us("KLGA", "LGA", "LaGuardia", "New York", 40.7794, -73.8803),
    _us("KSFO", "SFO", "San Francisco Intl", "San Francisco", 37.6196, -122.3656),
    _us("KSEA", "SEA", "Seattle-Tacoma Intl", "Seattle", 47.4447, -122.3144),
    _us("KLAS", "LAS", "Harry Reid Intl", "Las Vegas", 36.0719, -115.1634),
    _us("KMCO", "MCO", "Orlando Intl", "Orlando", 28.4182, -81.3241),
    _us("KMIA", "MIA", "Miami Intl", "Miami", 25.7881, -80.3169),
    _us("KPHX", "PHX", "Phoenix Sky Harbor Intl", "Phoenix", 33.4278, -112.0037),
    _us("KIAH", "IAH", "George Bush Intercontinental", "Houston", 29.9844, -95.3607),
    _us("KBOS", "BOS", "Boston Logan Intl", "Boston", 42.3606, -71.0097),
    _us("KMSP", "MSP", "Minneapolis-St. Paul Intl", "Minneapolis", 44.8852, -93.2313),
    _us("KDTW", "DTW", "Detroit Metropolitan", "Detroit", 42.2311, -83.3312),
    _us("KPHL", "PHL", "Philadelphia Intl", "Philadelphia", 39.8733, -75.2268),
    _us("KCLT", "CLT", "Charlotte Douglas Intl", "Charlotte", 35.2225, -80.9543),
    _us("KFLL", "FLL", "Fort Lauderdale-Hollywood Intl", "Fort Lauderdale", 26.0787, -80.1622),
    _us("KXNA", "XNA", "Northwest Arkansas Regional", "Fayetteville", 36.2897, -94.3115),
    # International: reported by Open-Meteo (looked up by coordinates)
    _intl("EGLL", "LHR", "London Heathrow", "London", "United Kingdom", "Europe", 51.4706, -0.4619),
    _intl("LFPG", "CDG", "Paris Charles de Gaulle", "Paris", "France", "Europe", 49.0097, 2.5479),
    _intl("EHAM", "AMS", "Amsterdam Schiphol", "Amsterdam", "Netherlands", "Europe", 52.3086, 4.7639),
    _intl("EDDF", "FRA", "Frankfurt am Main", "Frankfurt", "Germany", "Europe", 50.0333, 8.5706),
    _intl("LEMD", "MAD", "Madrid Barajas", "Madrid", "Spain", "Europe", 40.4936, -3.5668),
    _intl("LTFM", "IST", "Istanbul Airport", "Istanbul", "Turkey", "Europe", 41.2753, 28.7519),
    _intl("OMDB", "DXB", "Dubai Intl", "Dubai", "United Arab Emirates", "Middle East", 25.2528, 55.3644),
    _intl("OTHH", "DOH", "Hamad Intl", "Doha", "Qatar", "Middle East", 25.2731, 51.6081),
    _intl("WSSS", "SIN", "Singapore Changi", "Singapore", "Singapore", "Asia", 1.3502, 103.9940),
    _intl("VHHH", "HKG", "Hong Kong Intl", "Hong Kong", "Hong Kong", "Asia", 22.3089, 113.9146),
    _intl("RJTT", "HND", "Tokyo Haneda", "Tokyo", "Japan", "Asia", 35.5523, 139.7798),
    _intl("RKSI", "ICN", "Seoul Incheon", "Seoul", "South Korea", "Asia", 37.4692, 126.4505),
    _intl("ZBAA", "PEK", "Beijing Capital", "Beijing", "China", "Asia", 40.0801, 116.5846),
    _intl("VIDP", "DEL", "Indira Gandhi Intl", "Delhi", "India", "Asia", 28.5665, 77.1031),
    _intl("VTBS", "BKK", "Suvarnabhumi", "Bangkok", "Thailand", "Asia", 13.6900, 100.7501),
    _intl("YSSY", "SYD", "Sydney Kingsford Smith", "Sydney", "Australia", "Oceania", -33.9461, 151.1772),
    _intl("SBGR", "GRU", "Sao Paulo Guarulhos", "Sao Paulo", "Brazil", "South America", -23.4356, -46.4731),
    _intl("MMMX", "MEX", "Mexico City Intl", "Mexico City", "Mexico", "North America", 19.4363, -99.0721),
    _intl("CYYZ", "YYZ", "Toronto Pearson Intl", "Toronto", "Canada", "North America", 43.6777, -79.6248),
    _intl("FAOR", "JNB", "O. R. Tambo Intl", "Johannesburg", "South Africa", "Africa", -26.1392, 28.2460),
]

BY_ICAO: dict[str, Airport] = {a.icao: a for a in AIRPORTS}


def for_source(source: str) -> list[Airport]:
    return [a for a in AIRPORTS if a.source == source]
