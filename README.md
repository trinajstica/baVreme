# baVreme GNOME Extension

Top-bar weather extension for GNOME Shell using Open-Meteo APIs.

## Why this provider

This extension uses Open-Meteo geocoding + forecast services:
- Free to use
- No registration
- No API key
- Includes Postojna, Slovenia

## Features

- Weather icon and current temperature in GNOME top bar
- Detailed dropdown menu (condition, feels-like, wind, humidity, daily range)
- 3-day forecast in dropdown menu
- Manual refresh action
- Location search by name in preferences with exact-match selection
- Configurable city, country code, units, refresh interval, and panel position (left/center/right)

## Default setup

- City: Postojna
- Country code: SI
- Units: Metric
- Refresh interval: 15 min
- Panel position: Right

## Install locally (development)

Quick option:

```bash
./install.sh
```

Manual option:

1. Use extension UUID folder:
   - ~/.local/share/gnome-shell/extensions/ba-vreme@barko.generacija.si
2. Copy project files there.
3. Compile schema:
   - glib-compile-schemas ~/.local/share/gnome-shell/extensions/ba-vreme@barko.generacija.si/schemas
4. Restart GNOME Shell:
   - On X11: Alt+F2, type r, press Enter
   - On Wayland: log out and log in
5. Enable extension:
   - gnome-extensions enable ba-vreme@barko.generacija.si

## Useful commands

- Uninstall quickly:
  - ./uninstall.sh
- Disable:
  - gnome-extensions disable ba-vreme@barko.generacija.si
- List enabled:
  - gnome-extensions list --enabled

## Notes

- Use preferences to search for a city, region, or country name and save the exact location.
- Manual city and country code fields still work as a fallback and clear the saved exact-match coordinates.
- If weather does not refresh, check internet access and shell logs (journalctl /usr/bin/gnome-shell -f).

## About

- Author: BArko, 2026
- Programmer: SimOne
- Version: 1.00

## Contact

- For issues or questions: barko@generacija.si
