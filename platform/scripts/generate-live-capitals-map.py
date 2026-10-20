"""Build Q Session's vector world map from Natural Earth country outlines."""

from __future__ import annotations

import html
import sys
from pathlib import Path

import shapefile


WIDTH = 1440
HEIGHT = 700
MAP_LEFT = 40
MAP_TOP = 90
MAP_WIDTH = 1360
MAP_HEIGHT = 500


CAPITALS = [
    ("Ciudad de México", -99.1332, 19.4326, -14, 30, "end"),
    ("Washington", -77.0369, 38.9072, 14, -16, "start"),
    ("Bogotá", -74.0721, 4.7110, -14, 30, "end"),
    ("Brasília", -47.8825, -15.7942, 14, -16, "start"),
    ("Buenos Aires", -58.3816, -34.6037, -14, 31, "end"),
    ("Londres", -0.1276, 51.5072, -14, -18, "end"),
    ("Madrid", -3.7038, 40.4168, -14, 32, "end"),
    ("Berlín", 13.4050, 52.5200, 14, 30, "start"),
    ("Moscú", 37.6173, 55.7558, 14, -16, "start"),
    ("El Cairo", 31.2357, 30.0444, -14, 31, "end"),
    ("Nairobi", 36.8219, -1.2921, 14, 30, "start"),
    ("Nueva Delhi", 77.2090, 28.6139, -14, -17, "end"),
    ("Pekín", 116.4074, 39.9042, -14, -17, "end"),
    ("Tokio", 139.6917, 35.6895, 14, 29, "start"),
    ("Yakarta", 106.8456, -6.2088, -14, 30, "end"),
    ("Canberra", 149.1300, -35.2809, 14, 30, "start"),
]


def project(longitude: float, latitude: float) -> tuple[float, float]:
    return (
        MAP_LEFT + (longitude + 180.0) / 360.0 * MAP_WIDTH,
        MAP_TOP + (90.0 - latitude) / 180.0 * MAP_HEIGHT,
    )


def number(value: float) -> str:
    return f"{value:.1f}".rstrip("0").rstrip(".")


def country_paths(countries_path: Path) -> list[str]:
    paths: list[str] = []
    for shape in shapefile.Reader(str(countries_path)).shapes():
        starts = list(shape.parts) + [len(shape.points)]
        for index in range(len(starts) - 1):
            points = shape.points[starts[index] : starts[index + 1]]
            if len(points) < 3:
                continue
            projected = [project(longitude, latitude) for longitude, latitude in points]
            commands = [f"M{number(projected[0][0])},{number(projected[0][1])}"]
            commands.extend(f"L{number(x)},{number(y)}" for x, y in projected[1:])
            commands.append("Z")
            paths.append(f'<path d="{"".join(commands)}"/>')
    return paths


def build_svg(countries_path: Path) -> str:
    land = "\n      ".join(country_paths(countries_path))
    grid = []
    for longitude in range(-150, 180, 30):
        x, _ = project(longitude, 0)
        grid.append(f'<line x1="{number(x)}" y1="{MAP_TOP}" x2="{number(x)}" y2="{MAP_TOP + MAP_HEIGHT}"/>')
    for latitude in (-60, -30, 0, 30, 60):
        _, y = project(0, latitude)
        grid.append(f'<line x1="{MAP_LEFT}" y1="{number(y)}" x2="{MAP_LEFT + MAP_WIDTH}" y2="{number(y)}"/>')

    cities = []
    for index, (name, longitude, latitude, dx, dy, anchor) in enumerate(CAPITALS):
        x, y = project(longitude, latitude)
        label_x = x + dx
        label_y = y + dy
        delay = -(index % 8) * 0.32
        escaped_name = html.escape(name)
        cities.append(
            f'''<g class="city" transform="translate({number(x)} {number(y)})" style="--delay:{delay:.2f}s">
        <circle class="signal signal-one" r="8"/>
        <circle class="signal signal-two" r="8"/>
        <circle class="city-halo" r="9"/>
        <circle class="city-core" r="4"/>
      </g>
      <line class="city-leader" x1="{number(x)}" y1="{number(y)}" x2="{number(label_x - (4 if anchor == 'end' else -4))}" y2="{number(label_y - (5 if dy > 0 else -5))}"/>
      <text class="city-label" x="{number(label_x)}" y="{number(label_y)}" text-anchor="{anchor}">{escaped_name}</text>'''
        )

    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {WIDTH} {HEIGHT}" role="img" aria-labelledby="mapTitle mapDescription">
  <title id="mapTitle">Capitales del mundo conectadas por Q Session</title>
  <desc id="mapDescription">Planisferio vectorial ilustrativo con capitales que emiten ondas circulares de transmisión en vivo.</desc>
  <defs>
    <linearGradient id="ocean" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fbfdf9"/>
      <stop offset="0.55" stop-color="#eef8f7"/>
      <stop offset="1" stop-color="#e1f3f2"/>
    </linearGradient>
    <linearGradient id="land" x1="0" y1="0" x2="0.9" y2="1">
      <stop offset="0" stop-color="#d5eeeb"/>
      <stop offset="1" stop-color="#b8dedf"/>
    </linearGradient>
    <filter id="softGlow" x="-200%" y="-200%" width="400%" height="400%">
      <feGaussianBlur stdDeviation="4" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <style>
    .grid line {{ stroke:#75b9bf; stroke-width:1; stroke-opacity:.15; vector-effect:non-scaling-stroke; }}
    .land path {{ fill:url(#land); stroke:#5d9fab; stroke-width:1.2; stroke-opacity:.68; vector-effect:non-scaling-stroke; }}
    .signal {{ fill:none; stroke:#32b8c2; stroke-width:2.2; opacity:0; transform-box:fill-box; transform-origin:center; animation:signal-wave 3s ease-out infinite; animation-delay:var(--delay); vector-effect:non-scaling-stroke; }}
    .signal-two {{ animation-delay:calc(var(--delay) - 1.5s); }}
    .city-halo {{ fill:#65cdd1; opacity:.2; filter:url(#softGlow); }}
    .city-core {{ fill:#0f3152; stroke:#70d7d7; stroke-width:3; vector-effect:non-scaling-stroke; }}
    .city-leader {{ stroke:#4a8793; stroke-width:1.1; stroke-opacity:.48; vector-effect:non-scaling-stroke; }}
    .city-label {{ fill:#173a59; stroke:#f4faf8; stroke-width:5; paint-order:stroke; font:650 18px Inter,"Segoe UI",sans-serif; letter-spacing:.01em; }}
    .map-kicker {{ fill:#3d8993; font:750 15px Inter,"Segoe UI",sans-serif; letter-spacing:.18em; }}
    .map-note {{ fill:#5c7d8c; font:560 15px Inter,"Segoe UI",sans-serif; }}
    @keyframes signal-wave {{ 0% {{ opacity:.8; transform:scale(.5); }} 78%,100% {{ opacity:0; transform:scale(3.7); }} }}
    @media (prefers-reduced-motion: reduce) {{ .signal {{ animation:none; opacity:.28; transform:scale(2.3); }} .signal-two {{ opacity:.12; transform:scale(3.4); }} }}
  </style>
  <rect x="1" y="1" width="1438" height="698" rx="34" fill="url(#ocean)" stroke="#b7dcdd" stroke-width="2"/>
  <text class="map-kicker" x="55" y="48">CAPITALES CONECTADAS</text>
  <text class="map-note" x="1385" y="48" text-anchor="end">Una señal puede convertirse en encuentro.</text>
  <g class="grid">{"".join(grid)}</g>
  <g class="land">
      {land}
  </g>
  <g class="cities">
      {"".join(cities)}
  </g>
</svg>
'''


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: generate-live-capitals-map.py COUNTRIES_SHP OUTPUT_SVG")
    countries_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    if not countries_path.is_file():
        raise SystemExit(f"Natural Earth file not found: {countries_path}")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(build_svg(countries_path), encoding="utf-8")


if __name__ == "__main__":
    main()
