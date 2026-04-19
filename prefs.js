import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import Soup from 'gi://Soup?version=3.0';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const OPEN_METEO_GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';

function buildQuery(params) {
    return Object.entries(params)
        .filter(([, value]) => value !== null && value !== undefined && value !== '')
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
        .join('&');
}

function formatLocationChoice(result) {
    const location = [result.name, result.admin1, result.country]
        .filter(value => typeof value === 'string' && value.trim().length > 0)
        .join(', ');

    const coords = typeof result.latitude === 'number' && typeof result.longitude === 'number'
        ? `${result.latitude.toFixed(4)}, ${result.longitude.toFixed(4)}`
        : null;

    const elevation = typeof result.elevation === 'number'
        ? `${Math.round(result.elevation)} m`
        : null;

    const details = [coords, elevation]
        .filter(Boolean)
        .join(' • ');

    return details.length > 0 ? `${location} — ${details}` : location;
}

function formatSavedLocationName(name, countryCode) {
    const city = typeof name === 'string'
        ? name.trim().split(',')[0].trim()
        : '';
    const code = typeof countryCode === 'string'
        ? countryCode.trim().toUpperCase()
        : '';

    if (city.length === 0)
        return code.length > 0 ? code : '';

    return code.length > 0 ? `${city}, ${code}` : city;
}

function buildSavedLocationLabel(settings) {
    const savedName = settings.get_string('location-name').trim();
    const countryCode = settings.get_string('country-code').trim().toUpperCase();

    if (savedName.length > 0)
        return formatSavedLocationName(savedName, countryCode);

    const city = settings.get_string('city').trim();
    if (city.length === 0)
        return 'No location selected. Search by name below.';

    return countryCode.length > 0 ? `${city}, ${countryCode} (manual)` : `${city} (manual)`;
}

function hasConfiguredLocation(settings) {
    return settings.get_string('location-name').trim().length > 0 ||
        settings.get_string('city').trim().length > 0;
}

function sendAndRead(session, message) {
    return new Promise((resolve, reject) => {
        session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (source, result) => {
            try {
                resolve(source.send_and_read_finish(result));
            } catch (error) {
                reject(error);
            }
        });
    });
}

export default class BaVremePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const session = new Soup.Session({
            timeout: 15,
            idle_timeout: 15,
            user_agent: 'ba-vreme-gnome-extension/1.0',
        });

        let searchResults = [];
        let updatingLocationFields = false;
        let cityRow;
        let countryRow;
        let searchRow;
        let searchStatusRow;
        let resultsRow;
        let useResultButton;
        let selectedLocationRow;
        let clearLocationButton;

        const formatResultSubtitle = result => {
            if (!result)
                return '';

            return formatLocationChoice(result);
        };

        const clearResolvedLocation = () => {
            settings.set_string('location-name', '');
            settings.set_string('latitude', '');
            settings.set_string('longitude', '');
            settings.set_string('timezone', '');
        };

        const setDefaultSearchStatus = () => {
            if (hasConfiguredLocation(settings)) {
                searchStatusRow.title = 'Search for another location';
                searchStatusRow.subtitle = 'Type a city, region, or country name and save the exact match.';
            } else {
                searchStatusRow.title = 'No location selected';
                searchStatusRow.subtitle = 'Search by name below, then choose the correct result.';
            }
        };

        const updateSearchState = () => {
            const hasLocation = hasConfiguredLocation(settings);
            selectedLocationRow.subtitle = buildSavedLocationLabel(settings);
            clearLocationButton.set_sensitive(hasLocation);
            useResultButton.set_sensitive(searchResults.length > 0);
            resultsRow.visible = searchResults.length > 0;

            if (searchResults.length > 0) {
                const selectedIndex = Math.max(0, Math.min(searchResults.length - 1, resultsRow.selected));
                resultsRow.subtitle = formatResultSubtitle(searchResults[selectedIndex]);
            } else {
                resultsRow.subtitle = '';
            }
        };

        const resetSearchResults = () => {
            searchResults = [];
            resultsRow.model = Gtk.StringList.new([]);
            resultsRow.selected = 0;
            resultsRow.subtitle = '';
            updateSearchState();
        };

        const applySearchResult = result => {
            const city = typeof result.name === 'string' ? result.name.trim() : '';
            const countryCode = typeof result.country_code === 'string'
                ? result.country_code.trim().toUpperCase()
                : '';
            const locationName = formatSavedLocationName(city, countryCode) || city;

            updatingLocationFields = true;
            cityRow.text = city;
            countryRow.text = countryCode;
            searchRow.text = locationName;
            updatingLocationFields = false;

            settings.set_string('city', city);
            settings.set_string('country-code', countryCode);
            settings.set_string('location-name', locationName);
            settings.set_string('latitude', typeof result.latitude === 'number' ? String(result.latitude) : '');
            settings.set_string('longitude', typeof result.longitude === 'number' ? String(result.longitude) : '');
            settings.set_string('timezone', typeof result.timezone === 'string' ? result.timezone : '');

            updateSearchState();
            setDefaultSearchStatus();
        };

        const fetchJson = async url => {
            const message = Soup.Message.new('GET', url);
            message.request_headers.append('Accept', 'application/json');

            const bytes = await sendAndRead(session, message);
            if (message.status_code !== Soup.Status.OK)
                throw new Error(`HTTP ${message.status_code} for ${url}`);

            const payload = new TextDecoder('utf-8').decode(bytes.get_data());
            return JSON.parse(payload);
        };

        const searchLocations = async () => {
            const query = searchRow.text.trim();
            if (query.length === 0) {
                resetSearchResults();
                searchStatusRow.title = 'Enter a location name';
                searchStatusRow.subtitle = 'Examples: Ljubljana, Postojna, Berlin, New York';
                return;
            }

            searchButton.set_sensitive(false);
            searchStatusRow.title = 'Searching...';
            searchStatusRow.subtitle = query;
            resetSearchResults();

            try {
                const response = await fetchJson(`${OPEN_METEO_GEOCODING_URL}?${buildQuery({
                    name: query,
                    count: 8,
                    language: 'en',
                    format: 'json',
                })}`);

                searchResults = Array.isArray(response?.results) ? response.results : [];
                searchResults = searchResults.filter(result =>
                    typeof result.latitude === 'number' &&
                    typeof result.longitude === 'number'
                );

                if (searchResults.length === 0) {
                    searchStatusRow.title = 'No matches found';
                    searchStatusRow.subtitle = 'Try a more specific city, region, or country name.';
                    updateSearchState();
                    return;
                }

                resultsRow.model = Gtk.StringList.new(searchResults.map(result => formatLocationChoice(result)));
                resultsRow.selected = 0;
                searchStatusRow.title = `Found ${searchResults.length} match${searchResults.length === 1 ? '' : 'es'}`;
                searchStatusRow.subtitle = 'Choose a result and save it as the current location.';
                updateSearchState();
            } catch (error) {
                searchStatusRow.title = 'Location search failed';
                searchStatusRow.subtitle = error.message;
                resetSearchResults();
            } finally {
                searchButton.set_sensitive(true);
            }
        };

        const page = new Adw.PreferencesPage({
            title: 'baVreme',
            icon_name: 'weather-overcast-symbolic',
        });

        const searchGroup = new Adw.PreferencesGroup({
            title: 'Location',
            description: 'Search for a place by name and save the exact match with coordinates.',
        });

        selectedLocationRow = new Adw.ActionRow({
            title: 'Selected location',
            subtitle: buildSavedLocationLabel(settings),
        });

        clearLocationButton = new Gtk.Button({
            label: 'Clear',
            valign: Gtk.Align.CENTER,
        });
        clearLocationButton.connect('clicked', () => {
            updatingLocationFields = true;
            cityRow.text = '';
            countryRow.text = '';
            searchRow.text = '';
            updatingLocationFields = false;

            settings.set_string('city', '');
            settings.set_string('country-code', '');
            clearResolvedLocation();
            resetSearchResults();
            setDefaultSearchStatus();
            updateSearchState();
        });
        selectedLocationRow.add_suffix(clearLocationButton);
        searchGroup.add(selectedLocationRow);

        searchRow = new Adw.EntryRow({
            title: 'Search by name',
            text: settings.get_string('location-name') || settings.get_string('city'),
        });

        const searchButton = new Gtk.Button({
            label: 'Search',
            valign: Gtk.Align.CENTER,
        });
        searchButton.connect('clicked', () => {
            void searchLocations();
        });
        searchRow.add_suffix(searchButton);
        searchGroup.add(searchRow);

        searchStatusRow = new Adw.ActionRow({
            title: 'Search for a location',
            subtitle: 'Type a city, region, or country name and choose the correct result.',
        });
        searchGroup.add(searchStatusRow);

        resultsRow = new Adw.ComboRow({
            title: 'Matches',
            subtitle: '',
            model: Gtk.StringList.new([]),
            visible: false,
        });

        resultsRow.connect('notify::selected', () => {
            updateSearchState();
        });

        useResultButton = new Gtk.Button({
            label: 'Use match',
            valign: Gtk.Align.CENTER,
        });
        useResultButton.connect('clicked', () => {
            const index = Math.max(0, Math.min(searchResults.length - 1, resultsRow.selected));
            const result = searchResults[index];
            if (result)
                applySearchResult(result);
        });
        resultsRow.add_suffix(useResultButton);
        searchGroup.add(resultsRow);
        page.add(searchGroup);

        const manualLocationGroup = new Adw.PreferencesGroup({
            title: 'Manual fallback',
            description: 'Optional. Editing these fields clears the saved exact-match coordinates.',
        });

        cityRow = new Adw.EntryRow({
            title: 'City',
            text: settings.get_string('city'),
        });
        cityRow.connect('changed', row => {
            if (updatingLocationFields)
                return;

            const value = row.text.trim();
            settings.set_string('city', value);
            clearResolvedLocation();
            updateSearchState();
            setDefaultSearchStatus();
        });

        countryRow = new Adw.EntryRow({
            title: 'Country code (optional)',
            text: settings.get_string('country-code'),
        });
        countryRow.connect('changed', row => {
            if (updatingLocationFields)
                return;

            const value = row.text.trim().toUpperCase().slice(0, 2);
            if (row.text !== value) {
                updatingLocationFields = true;
                row.text = value;
                updatingLocationFields = false;
            }

            settings.set_string('country-code', value);
            clearResolvedLocation();
            updateSearchState();
            setDefaultSearchStatus();
        });

        manualLocationGroup.add(cityRow);
        manualLocationGroup.add(countryRow);
        page.add(manualLocationGroup);

        const behaviorGroup = new Adw.PreferencesGroup({
            title: 'Behavior',
        });

        const unitsModel = Gtk.StringList.new([
            'Metric (C, km/h)',
            'Imperial (F, mph)',
        ]);

        const unitsRow = new Adw.ComboRow({
            title: 'Units',
            model: unitsModel,
        });
        unitsRow.selected = settings.get_string('units') === 'imperial' ? 1 : 0;
        unitsRow.connect('notify::selected', row => {
            settings.set_string('units', row.selected === 1 ? 'imperial' : 'metric');
        });

        const refreshRow = new Adw.ActionRow({
            title: 'Refresh interval (minutes)',
        });

        const refreshSpin = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: 5,
                upper: 180,
                step_increment: 1,
                page_increment: 5,
                value: settings.get_int('refresh-minutes'),
            }),
            numeric: true,
            valign: Gtk.Align.CENTER,
        });
        refreshSpin.connect('value-changed', spin => {
            settings.set_int('refresh-minutes', spin.get_value_as_int());
        });

        refreshRow.add_suffix(refreshSpin);
        refreshRow.activatable_widget = refreshSpin;

        const panelPositionModel = Gtk.StringList.new([
            'Left',
            'Center',
            'Right',
        ]);

        const panelPositionValues = ['left', 'center', 'right'];

        const panelPositionRow = new Adw.ComboRow({
            title: 'Panel position',
            subtitle: 'Where weather is shown in the top bar',
            model: panelPositionModel,
        });

        const currentPosition = settings.get_string('panel-position');
        const currentPositionIndex = panelPositionValues.indexOf(currentPosition);
        panelPositionRow.selected = currentPositionIndex >= 0 ? currentPositionIndex : 2;
        panelPositionRow.connect('notify::selected', row => {
            const index = Math.max(0, Math.min(panelPositionValues.length - 1, row.selected));
            settings.set_string('panel-position', panelPositionValues[index]);
        });

        const showLocationRow = new Adw.SwitchRow({
            title: 'Show location in panel',
            subtitle: 'Display the saved location name before the icon in the top bar',
            active: settings.get_boolean('show-location-in-panel'),
        });
        showLocationRow.connect('notify::active', row => {
            settings.set_boolean('show-location-in-panel', row.active);
        });

        behaviorGroup.add(unitsRow);
        behaviorGroup.add(refreshRow);
        behaviorGroup.add(panelPositionRow);
        behaviorGroup.add(showLocationRow);
        page.add(behaviorGroup);

        const providerGroup = new Adw.PreferencesGroup({
            title: 'Provider',
            description: 'Data source: Open-Meteo public API (no registration, no API key).',
        });

        const providerRow = new Adw.ActionRow({
            title: 'Open-Meteo weather + geocoding endpoints',
            subtitle: 'Location search and forecast data work without API key',
        });
        providerGroup.add(providerRow);
        page.add(providerGroup);

        const aboutGroup = new Adw.PreferencesGroup({
            title: 'About',
            description: 'Extension authorship and version information.',
        });

        aboutGroup.add(new Adw.ActionRow({
            title: 'Author',
            subtitle: 'BArko, 2026',
        }));
        aboutGroup.add(new Adw.ActionRow({
            title: 'Programmer',
            subtitle: 'SimOne',
        }));
        aboutGroup.add(new Adw.ActionRow({
            title: 'Version',
            subtitle: '1.00',
        }));
        page.add(aboutGroup);

        updateSearchState();
        setDefaultSearchStatus();
        window.add(page);
        window.set_default_size(620, 420);
        if (window.set_search_enabled)
            window.set_search_enabled(true);
    }
}
