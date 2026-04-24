import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Soup from 'gi://Soup?version=3.0';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const MIN_REFRESH_MINUTES = 5;
const MAX_REFRESH_MINUTES = 180;
const OPEN_METEO_GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

function clampRefreshMinutes(value) {
    return Math.min(MAX_REFRESH_MINUTES, Math.max(MIN_REFRESH_MINUTES, value));
}

function buildQuery(params) {
    return Object.entries(params)
        .filter(([, value]) => value !== null && value !== undefined && value !== '')
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
        .join('&');
}

function openMeteoCondition(weatherCode, isDay = true) {
    const clearIcon = isDay ? 'weather-clear-symbolic' : 'weather-clear-night-symbolic';
    const fewCloudsIcon = 'weather-few-clouds-symbolic';

    switch (weatherCode) {
    case 0:
        return {summary: 'Clear sky', icon: clearIcon};
    case 1:
        return {summary: 'Mainly clear', icon: fewCloudsIcon};
    case 2:
        return {summary: 'Partly cloudy', icon: fewCloudsIcon};
    case 3:
        return {summary: 'Overcast', icon: 'weather-overcast-symbolic'};
    case 45:
    case 48:
        return {summary: 'Fog', icon: 'weather-fog-symbolic'};
    case 51:
    case 53:
    case 55:
    case 56:
    case 57:
        return {summary: 'Drizzle', icon: 'weather-showers-symbolic'};
    case 61:
    case 63:
    case 65:
    case 66:
    case 67:
    case 80:
    case 81:
    case 82:
        return {summary: 'Rain', icon: 'weather-showers-symbolic'};
    case 71:
    case 73:
    case 75:
    case 77:
    case 85:
    case 86:
        return {summary: 'Snow', icon: 'weather-snow-symbolic'};
    case 95:
    case 96:
    case 99:
        return {summary: 'Thunderstorm', icon: 'weather-storm-symbolic'};
    default:
        return {summary: 'Unknown', icon: 'weather-severe-alert-symbolic'};
    }
}

function formatForecastLabel(dateText, index) {
    if (index === 0)
        return 'Today';

    const date = new Date(dateText ?? '');
    if (Number.isNaN(date.getTime()))
        return `Day ${index + 1}`;

    return date.toLocaleDateString('en-US', {weekday: 'short'});
}

function formatNumber(value) {
    if (value === null || value === undefined || Number.isNaN(value))
        return '--';

    return `${Math.round(value)}`;
}

function formatUpdatedTimestamp(value) {
    if (!value)
        return 'unknown';

    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
        return value;

    const localDate = date.toLocaleDateString(undefined);
    const localTime = date.toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit'});
    return `${localDate} ${localTime}`;
}

function formatTempWithUnit(value, unitLabel) {
    return `${formatNumber(value)} \u00b0${unitLabel}`;
}

function formatWindWithUnit(value, unitLabel) {
    return `${formatNumber(value)} ${unitLabel}`;
}

function formatPercentage(value) {
    return value === null || value === undefined || Number.isNaN(value)
        ? '--'
        : `${Math.round(value)}%`;
}

function formatPressure(value) {
    return value === null || value === undefined || Number.isNaN(value)
        ? '--'
        : `${Math.round(value)} hPa`;
}

function formatPrecipitation(value) {
    return value === null || value === undefined || Number.isNaN(value)
        ? '--'
        : `${value.toFixed(1)} mm`;
}

function formatUvIndex(value) {
    return value === null || value === undefined || Number.isNaN(value)
        ? '--'
        : `${Math.round(value * 10) / 10}`;
}

function formatClockTime(value) {
    if (!value)
        return '--';

    const date = new Date(value);
    if (!Number.isNaN(date.getTime()))
        return date.toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit'});

    const timePart = String(value).split('T')[1] ?? '';
    return timePart.length >= 5 ? timePart.slice(0, 5) : String(value);
}

function getCurrentHourLabel(timezone) {
    try {
        const now = new Date();
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone || undefined,
            hour12: false,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
        }).formatToParts(now);

        const year = parts.find(part => part.type === 'year')?.value ?? '';
        const month = parts.find(part => part.type === 'month')?.value ?? '';
        const day = parts.find(part => part.type === 'day')?.value ?? '';
        const hour = parts.find(part => part.type === 'hour')?.value ?? '';

        if (!year || !month || !day || !hour)
            return '';

        return `${year}-${month}-${day}T${hour}`;
    } catch (error) {
        return '';
    }
}

function parseCoordinate(value) {
    const parsedValue = Number.parseFloat(value);
    return Number.isFinite(parsedValue) ? parsedValue : null;
}

function formatPanelLocationName(name, countryCode) {
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

const WeatherDetailsDialog = GObject.registerClass(
class WeatherDetailsDialog extends ModalDialog.ModalDialog {
    _init() {
        super._init({styleClass: 'ba-vreme-details-dialog'});

        this._scrollView = new St.ScrollView({
            style_class: 'ba-vreme-details-scrollview',
            overlay_scrollbars: true,
            x_expand: true,
            y_expand: true,
        });
        this._scrollView.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);

        this._contentBox = new St.BoxLayout({
            vertical: true,
            style_class: 'ba-vreme-details-content',
            x_expand: true,
        });

        this._scrollView.set_child(this._contentBox);
        this.contentLayout.add_child(this._scrollView);

        this.addButton({
            label: 'Close',
            action: () => this.close(),
            key: Clutter.KEY_Escape,
        });
    }

    _clearContent() {
        for (const child of this._contentBox.get_children())
            child.destroy();
    }

    _addSectionTitle(text) {
        this._contentBox.add_child(new St.Label({
            text,
            style_class: 'ba-vreme-details-section-title',
            x_align: Clutter.ActorAlign.START,
        }));
    }

    _addInfoRow(label, value) {
        const row = new St.BoxLayout({
            style_class: 'ba-vreme-details-row',
            x_expand: true,
        });

        const keyLabel = new St.Label({
            text: `${label}:`,
            style_class: 'ba-vreme-details-key',
            x_align: Clutter.ActorAlign.START,
        });

        const valueLabel = new St.Label({
            text: value,
            style_class: 'ba-vreme-details-value',
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
        });

        valueLabel.clutter_text.set_line_wrap(true);
        row.add_child(keyLabel);
        row.add_child(valueLabel);
        this._contentBox.add_child(row);
    }

    _addForecastRows(forecast, tempUnit) {
        this._addSectionTitle('3-day outlook');

        for (let i = 0; i < forecast.length; i++) {
            const day = forecast[i];
            const dayLabel = formatForecastLabel(day?.date, i);
            const summary = day?.summary ?? 'unavailable';
            const rainChance = formatPercentage(day?.precipitationProbabilityMax);
            const uvMax = formatUvIndex(day?.uvIndexMax);

            const row = new St.BoxLayout({
                style_class: 'ba-vreme-forecast-row',
                x_expand: true,
            });

            const icon = new St.Icon({
                icon_name: day?.icon ?? 'weather-severe-alert-symbolic',
                style_class: 'ba-vreme-forecast-icon',
            });

            const textBox = new St.BoxLayout({
                vertical: true,
                x_expand: true,
            });

            const titleLabel = new St.Label({
                text: `${dayLabel}: ${summary}`,
                style_class: 'ba-vreme-forecast-day-title',
                x_align: Clutter.ActorAlign.START,
                x_expand: true,
            });
            titleLabel.clutter_text.set_line_wrap(true);

            const detailLabel = new St.Label({
                text: `${formatTempWithUnit(day?.min, tempUnit)} \u2013 ${formatTempWithUnit(day?.max, tempUnit)}, rain ${rainChance}, UV ${uvMax}`,
                style_class: 'ba-vreme-forecast-day-detail',
                x_align: Clutter.ActorAlign.START,
                x_expand: true,
            });
            detailLabel.clutter_text.set_line_wrap(true);

            textBox.add_child(titleLabel);
            textBox.add_child(detailLabel);
            row.add_child(icon);
            row.add_child(textBox);
            this._contentBox.add_child(row);
        }
    }

    _addHourlyRows(hourlyToday, tempUnit, windUnit, currentHourLabel) {
        this._addSectionTitle('Hourly forecast (today)');

        if (!hourlyToday || hourlyToday.length === 0) {
            this._contentBox.add_child(new St.Label({
                text: 'Hourly data unavailable for the selected day.',
                style_class: 'ba-vreme-details-list-item',
                x_align: Clutter.ActorAlign.START,
            }));
            return;
        }

        let visibleHours = hourlyToday;
        if (currentHourLabel) {
            const startIndex = hourlyToday.findIndex(hour => hour.time.startsWith(currentHourLabel));
            if (startIndex >= 0) {
                visibleHours = hourlyToday.slice(startIndex);
            } else {
                visibleHours = hourlyToday.filter(hour => hour.time >= currentHourLabel);
                if (visibleHours.length === 0)
                    visibleHours = hourlyToday.slice(-1);
            }
        }

        for (const hour of visibleHours) {
            const isCurrentHour = currentHourLabel && hour.time.startsWith(currentHourLabel);
            const row = new St.BoxLayout({
                style_class: 'ba-vreme-hourly-row',
                x_expand: true,
            });

            const icon = new St.Icon({
                icon_name: hour.icon ?? 'weather-severe-alert-symbolic',
                style_class: 'ba-vreme-hourly-icon',
            });

            const textBox = new St.BoxLayout({
                vertical: true,
                x_expand: true,
            });

            const titleLabel = new St.Label({
                text: `${hour.shortTime ?? formatClockTime(hour.time)}  ${hour.summary ?? 'Unknown'}`,
                style_class: `ba-vreme-hourly-title${isCurrentHour ? ' ba-vreme-hourly-current' : ''}`,
                x_align: Clutter.ActorAlign.START,
                x_expand: true,
            });
            titleLabel.clutter_text.set_line_wrap(true);

            const detailsLabel = new St.Label({
                text:
                    `${formatTempWithUnit(hour.temperature, tempUnit)} ` +
                    `(feels ${formatTempWithUnit(hour.feelsLike, tempUnit)}), ` +
                    `rain ${formatPercentage(hour.precipitationProbability)}, ` +
                    `wind ${formatWindWithUnit(hour.windSpeed, windUnit)}, ` +
                    `humidity ${formatPercentage(hour.humidity)}, ` +
                    `cloud ${formatPercentage(hour.cloudCover)}, ` +
                    `pressure ${formatPressure(hour.pressureMsl)}, ` +
                    `UV ${formatUvIndex(hour.uvIndex)}`,
                style_class: `ba-vreme-hourly-value${isCurrentHour ? ' ba-vreme-hourly-current-value' : ''}`,
                x_align: Clutter.ActorAlign.START,
                x_expand: true,
            });
            detailsLabel.clutter_text.set_line_wrap(true);

            textBox.add_child(titleLabel);
            textBox.add_child(detailsLabel);
            row.add_child(icon);
            row.add_child(textBox);
            this._contentBox.add_child(row);
        }
    }

    present(data, statusText = '') {
        this._clearContent();

        const locationName = data?.locationName ?? 'Weather details';
        this._contentBox.add_child(new St.Label({
            text: locationName,
            style_class: 'ba-vreme-details-title',
            x_align: Clutter.ActorAlign.START,
        }));

        this._contentBox.add_child(new St.Label({
            text: 'Full-day weather overview',
            style_class: 'ba-vreme-details-subtitle',
            x_align: Clutter.ActorAlign.START,
        }));

        const currentConditionIcon = data?.current?.icon ?? 'weather-severe-alert-symbolic';
        const headerBox = new St.BoxLayout({
            style_class: 'ba-vreme-details-header',
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
        });
        headerBox.add_child(new St.Icon({
            icon_name: currentConditionIcon,
            style_class: 'ba-vreme-details-main-icon',
        }));
        this._contentBox.add_child(headerBox);

        if (!data) {
            this._contentBox.add_child(new St.Label({
                text: 'No weather data available yet. Please refresh weather first.',
                style_class: 'ba-vreme-details-list-item',
                x_align: Clutter.ActorAlign.START,
            }));

            if (statusText) {
                this._contentBox.add_child(new St.Label({
                    text: `Status: ${statusText}`,
                    style_class: 'ba-vreme-details-list-item',
                    x_align: Clutter.ActorAlign.START,
                }));
            }

            return;
        }

        const current = data.current ?? {};
        const forecast = Array.isArray(data.forecast) ? data.forecast : [];
        const today = forecast[0] ?? {};
        const details = data.details ?? {};
        const tempUnit = data.units?.temperature ?? 'C';
        const windUnit = data.units?.windSpeed ?? 'km/h';

        this._addSectionTitle('Current conditions');
        this._addInfoRow('Condition', current.summary ?? 'unavailable');
        this._addInfoRow('Temperature', formatTempWithUnit(current.temperature, tempUnit));
        this._addInfoRow('Feels like', formatTempWithUnit(current.feelsLike, tempUnit));
        this._addInfoRow('Today range', `${formatTempWithUnit(today.min, tempUnit)} to ${formatTempWithUnit(today.max, tempUnit)}`);
        this._addInfoRow('Wind', formatWindWithUnit(current.windSpeed, windUnit));
        this._addInfoRow('Wind gusts', formatWindWithUnit(current.windGusts, windUnit));
        this._addInfoRow('Humidity', formatPercentage(current.relativeHumidity));
        this._addInfoRow('Cloud cover', formatPercentage(current.cloudCover));
        this._addInfoRow('Pressure (MSL)', formatPressure(current.pressureMsl));
        this._addInfoRow('Precipitation now', formatPrecipitation(current.precipitation));
        this._addInfoRow('UV index now', formatUvIndex(current.uvIndex));
        this._addInfoRow('Sunrise', formatClockTime(details.sunrise));
        this._addInfoRow('Sunset', formatClockTime(details.sunset));
        this._addInfoRow('Max rain chance today', formatPercentage(details.precipitationProbabilityMax));
        this._addInfoRow('Max UV today', formatUvIndex(details.uvIndexMax));
        this._addInfoRow('Timezone', details.timezone ?? 'unknown');

        this._addForecastRows(forecast, tempUnit);
        const currentHourLabel = getCurrentHourLabel(details.timezone);
        this._addHourlyRows(details.hourlyToday, tempUnit, windUnit, currentHourLabel);

        this._addSectionTitle('Data status');
        this._addInfoRow('Updated', formatUpdatedTimestamp(data.refreshedAt || current.time));
        this._addInfoRow('Status', statusText || 'OK');
    }
});

const WeatherIndicator = GObject.registerClass(
class WeatherIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'BaVremeIndicator', false);

        this._extension = extension;
        this._settings = extension.getSettings();
        this._settingSignals = [];
        this._refreshSourceId = 0;
        this._refreshInProgress = false;
        this._refreshQueued = false;
        this._latestWeatherData = null;
        this._detailsDialog = null;

        this._session = new Soup.Session({
            timeout: 15,
            idle_timeout: 15,
            user_agent: 'ba-vreme-gnome-extension/1.0',
        });

        this._buildIndicator();
        this._buildMenu();
        this._watchSettings();

        this._resetRefreshTimer();
        this._refreshWeather();
    }

    _buildIndicator() {
        const box = new St.BoxLayout({style_class: 'panel-status-menu-box'});

        this._locationLabel = new St.Label({
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
            visible: this._showLocationInPanel(),
            style_class: 'ba-vreme-location-label',
        });

        this._icon = new St.Icon({
            icon_name: 'weather-overcast-symbolic',
            style_class: 'system-status-icon',
        });

        this._temperatureLabel = new St.Label({
            text: '--',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'ba-vreme-label',
        });

        box.add_child(this._locationLabel);
        box.add_child(this._icon);
        box.add_child(this._temperatureLabel);
        this.add_child(box);
    }

    _buildMenu() {
        this._locationItem = new PopupMenu.PopupMenuItem('Location: loading...');
        this._locationItem.add_style_class_name('ba-vreme-location-action');
        this._locationItem.connect('activate', () => {
            this._openDetailsDialog();
        });
        this.menu.addMenuItem(this._locationItem);

        this._summaryItem = this._makeReadonlyItem('Condition: loading...');
        this._tempItem = this._makeReadonlyItem('Temperature: --');
        this._rangeItem = this._makeReadonlyItem('Today range: --');
        this._windItem = this._makeReadonlyItem('Wind: --');
        this._humidityItem = this._makeReadonlyItem('Humidity: --');
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._forecastTitleItem = this._makeReadonlyItem('3-day forecast:');
        this._forecastDayItems = [
            this._makeReadonlyItem('Today: --'),
            this._makeReadonlyItem('Day 2: --'),
            this._makeReadonlyItem('Day 3: --'),
        ];
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._updatedItem = this._makeReadonlyItem('Updated: --');
        this._statusItem = this._makeReadonlyItem('Status: fetching weather data...');

        this._preferencesItem = new PopupMenu.PopupMenuItem('Open settings');
        this._preferencesItem.connect('activate', () => {
            try {
                this._extension.openPreferences?.();
            } catch (error) {
                log(`[ba-vreme] Failed to open preferences: ${error}`);
            }
        });
        this.menu.addMenuItem(this._preferencesItem);

        this._refreshItem = new PopupMenu.PopupMenuItem('Refresh now');
        this._refreshItem.connect('activate', () => {
            this._refreshWeather(true);
        });

        this.menu.addMenuItem(this._refreshItem);
    }

    _makeReadonlyItem(text) {
        const item = new PopupMenu.PopupMenuItem(text, {
            reactive: false,
            can_focus: false,
        });

        this.menu.addMenuItem(item);
        return item;
    }

    _openDetailsDialog() {
        const statusText = this._statusItem.label.text.replace(/^Status:\s*/, '');
        this.menu.close();

        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            try {
                const dialog = new WeatherDetailsDialog();
                dialog.connect('destroy', () => {
                    if (this._detailsDialog === dialog)
                        this._detailsDialog = null;
                });

                this._detailsDialog = dialog;
                dialog.present(this._latestWeatherData, statusText);
                const opened = dialog.open();
                if (!opened)
                    Main.notify('baVreme', 'Weather details window could not be opened.');
            } catch (error) {
                log(`[ba-vreme] Failed to open details dialog: ${error}`);
                Main.notify('baVreme', 'Failed to open weather details window.');
            }

            return GLib.SOURCE_REMOVE;
        });
    }

    _watchSettings() {
        const keys = ['city', 'country-code', 'location-name', 'latitude', 'longitude', 'timezone', 'units', 'refresh-minutes', 'show-location-in-panel'];

        for (const key of keys) {
            const signalId = this._settings.connect(`changed::${key}`, () => {
                this._resetRefreshTimer();
                this._refreshWeather();
            });
            this._settingSignals.push(signalId);
        }
    }

    _disconnectSettings() {
        for (const signalId of this._settingSignals)
            this._settings.disconnect(signalId);

        this._settingSignals = [];
    }

    _getUnits() {
        return this._settings.get_string('units') === 'imperial' ? 'imperial' : 'metric';
    }

    _getCity() {
        return this._settings.get_string('city').trim();
    }

    _getCountryCode() {
        return this._settings.get_string('country-code').trim().toUpperCase();
    }

    _getLocationName() {
        return this._settings.get_string('location-name').trim();
    }

    _getSavedLocation() {
        const latitude = parseCoordinate(this._settings.get_string('latitude').trim());
        const longitude = parseCoordinate(this._settings.get_string('longitude').trim());

        if (latitude === null || longitude === null)
            return null;

        return {
            name: this._getLocationName() || this._getCity() || 'Selected location',
            countryCode: this._getCountryCode(),
            latitude,
            longitude,
            timezone: this._settings.get_string('timezone').trim() || 'auto',
        };
    }

    _showLocationInPanel() {
        return this._settings.get_boolean('show-location-in-panel');
    }

    _resetRefreshTimer() {
        this._clearRefreshTimer();

        const refreshMinutes = clampRefreshMinutes(this._settings.get_int('refresh-minutes'));
        this._refreshSourceId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, refreshMinutes * 60, () => {
            this._refreshWeather();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _clearRefreshTimer() {
        if (this._refreshSourceId !== 0) {
            GLib.source_remove(this._refreshSourceId);
            this._refreshSourceId = 0;
        }
    }

    _unitLabel() {
        return this._getUnits() === 'imperial' ? 'F' : 'C';
    }

    _windLabel() {
        return this._getUnits() === 'imperial' ? 'mph' : 'km/h';
    }

    _formatCompactTemp(value) {
        return `${formatNumber(value)}${this._unitLabel()}`;
    }

    _formatTemp(value) {
        return `${formatNumber(value)} °${this._unitLabel()}`;
    }

    async _fetchJson(url, headers = {}) {
        const message = Soup.Message.new('GET', url);
        message.request_headers.append('Accept', 'application/json');

        for (const [name, value] of Object.entries(headers)) {
            if (value)
                message.request_headers.append(name, value);
        }

        const bytes = await sendAndRead(this._session, message);
        if (message.status_code !== Soup.Status.OK)
            throw new Error(`HTTP ${message.status_code} for ${url}`);

        const payload = new TextDecoder('utf-8').decode(bytes.get_data());
        return JSON.parse(payload);
    }

    async _resolveLocation() {
        const savedLocation = this._getSavedLocation();
        if (savedLocation)
            return savedLocation;

        const city = this._getCity();
        if (city.length === 0)
            throw new Error('Location not configured. Open settings and search for a location.');

        const countryCode = this._getCountryCode();

        const geocodingUrl = `${OPEN_METEO_GEOCODING_URL}?${buildQuery({
            name: city,
            count: 1,
            language: 'en',
            format: 'json',
            countryCode: countryCode.length === 2 ? countryCode : null,
        })}`;

        const response = await this._fetchJson(geocodingUrl);
        const results = response?.results ?? [];

        if (!Array.isArray(results) || results.length === 0)
            throw new Error(`Location not found: ${city}`);

        const location = results[0];
        if (typeof location.latitude !== 'number' || typeof location.longitude !== 'number')
            throw new Error('Location coordinates missing in provider response');

        return {
            name: location.name ?? city,
            countryCode: location.country_code ?? countryCode,
            latitude: location.latitude,
            longitude: location.longitude,
            timezone: location.timezone ?? 'auto',
        };
    }

    async _fetchWeather() {
        const units = this._getUnits();
        const isMetric = units === 'metric';
        const location = await this._resolveLocation();

        const forecastUrl = `${OPEN_METEO_FORECAST_URL}?${buildQuery({
            latitude: location.latitude,
            longitude: location.longitude,
            timezone: location.timezone,
            forecast_days: 3,
            current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_gusts_10m,cloud_cover,pressure_msl,precipitation,uv_index,is_day',
            daily: 'weather_code,temperature_2m_min,temperature_2m_max,sunrise,sunset,precipitation_probability_max,uv_index_max',
            hourly: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,weather_code,wind_speed_10m,cloud_cover,pressure_msl,uv_index',
            temperature_unit: isMetric ? 'celsius' : 'fahrenheit',
            windspeed_unit: isMetric ? 'kmh' : 'mph',
        })}`;

        const forecastResponse = await this._fetchJson(forecastUrl);
        const current = forecastResponse?.current;
        const daily = forecastResponse?.daily;
        const hourly = forecastResponse?.hourly;

        if (!current)
            throw new Error('Current weather data missing in provider response');
        if (!daily)
            throw new Error('Forecast weather data missing in provider response');

        const dailyTimes = Array.isArray(daily.time) ? daily.time : [];
        if (dailyTimes.length === 0)
            throw new Error('Forecast days missing in provider response');

        const dailyCodes = Array.isArray(daily.weather_code) ? daily.weather_code : [];
        const dailyMin = Array.isArray(daily.temperature_2m_min) ? daily.temperature_2m_min : [];
        const dailyMax = Array.isArray(daily.temperature_2m_max) ? daily.temperature_2m_max : [];
        const dailySunrise = Array.isArray(daily.sunrise) ? daily.sunrise : [];
        const dailySunset = Array.isArray(daily.sunset) ? daily.sunset : [];
        const dailyPrecipitationProbabilityMax = Array.isArray(daily.precipitation_probability_max)
            ? daily.precipitation_probability_max
            : [];
        const dailyUvIndexMax = Array.isArray(daily.uv_index_max) ? daily.uv_index_max : [];

        const hourlyTimes = Array.isArray(hourly?.time) ? hourly.time : [];
        const hourlyTemperature = Array.isArray(hourly?.temperature_2m) ? hourly.temperature_2m : [];
        const hourlyFeelsLike = Array.isArray(hourly?.apparent_temperature) ? hourly.apparent_temperature : [];
        const hourlyHumidity = Array.isArray(hourly?.relative_humidity_2m) ? hourly.relative_humidity_2m : [];
        const hourlyPrecipitationProbability = Array.isArray(hourly?.precipitation_probability)
            ? hourly.precipitation_probability
            : [];
        const hourlyWeatherCode = Array.isArray(hourly?.weather_code) ? hourly.weather_code : [];
        const hourlyWindSpeed = Array.isArray(hourly?.wind_speed_10m) ? hourly.wind_speed_10m : [];
        const hourlyCloudCover = Array.isArray(hourly?.cloud_cover) ? hourly.cloud_cover : [];
        const hourlyPressure = Array.isArray(hourly?.pressure_msl) ? hourly.pressure_msl : [];
        const hourlyUvIndex = Array.isArray(hourly?.uv_index) ? hourly.uv_index : [];

        const forecast = dailyTimes.slice(0, 3).map((date, index) => {
            const condition = openMeteoCondition(dailyCodes[index], true);
            return {
                date,
                summary: condition.summary,
                icon: condition.icon,
                min: dailyMin[index],
                max: dailyMax[index],
                sunrise: dailySunrise[index],
                sunset: dailySunset[index],
                precipitationProbabilityMax: dailyPrecipitationProbabilityMax[index],
                uvIndexMax: dailyUvIndexMax[index],
            };
        });

        const todayDate = dailyTimes[0];
        const hourlyToday = [];

        for (let index = 0; index < hourlyTimes.length; index++) {
            const timestamp = hourlyTimes[index];
            if (typeof timestamp !== 'string' || !timestamp.startsWith(`${todayDate}T`))
                continue;

            const hour = Number.parseInt(timestamp.slice(11, 13), 10);
            const isDay = Number.isFinite(hour) ? hour >= 6 && hour < 20 : true;
            const condition = openMeteoCondition(hourlyWeatherCode[index], isDay);

            hourlyToday.push({
                time: timestamp,
                shortTime: timestamp.length >= 16 ? timestamp.slice(11, 16) : timestamp,
                summary: condition.summary,
                icon: condition.icon,
                temperature: hourlyTemperature[index],
                feelsLike: hourlyFeelsLike[index],
                humidity: hourlyHumidity[index],
                precipitationProbability: hourlyPrecipitationProbability[index],
                windSpeed: hourlyWindSpeed[index],
                cloudCover: hourlyCloudCover[index],
                pressureMsl: hourlyPressure[index],
                uvIndex: hourlyUvIndex[index],
            });

            if (hourlyToday.length >= 24)
                break;
        }

        const currentCondition = openMeteoCondition(current.weather_code, current.is_day !== 0);

        return {
            locationName: formatPanelLocationName(location.name, location.countryCode),
            units: {
                temperature: this._unitLabel(),
                windSpeed: this._windLabel(),
            },
            current: {
                summary: currentCondition.summary,
                icon: currentCondition.icon,
                temperature: current.temperature_2m,
                feelsLike: current.apparent_temperature,
                windSpeed: current.wind_speed_10m,
                windGusts: current.wind_gusts_10m,
                relativeHumidity: current.relative_humidity_2m,
                cloudCover: current.cloud_cover,
                pressureMsl: current.pressure_msl,
                precipitation: current.precipitation,
                uvIndex: current.uv_index,
                time: current.time,
            },
            forecast,
            details: {
                timezone: forecastResponse?.timezone ?? location.timezone,
                sunrise: dailySunrise[0],
                sunset: dailySunset[0],
                precipitationProbabilityMax: dailyPrecipitationProbabilityMax[0],
                uvIndexMax: dailyUvIndexMax[0],
                hourlyToday,
            },
            refreshedAt: new Date().toISOString(),
        };
    }

    _setStatus(text) {
        this._statusItem.label.text = `Status: ${text}`;
    }

    _applyForecastData(forecast) {
        for (let i = 0; i < this._forecastDayItems.length; i++) {
            const day = forecast[i];
            const dayLabel = formatForecastLabel(day?.date, i);
            const summary = day?.summary ?? 'unavailable';
            this._forecastDayItems[i].label.text =
                `${dayLabel}: ${summary}, ${this._formatTemp(day?.min)} to ${this._formatTemp(day?.max)}`;
        }
    }

    _applyWeatherData(data) {
        const current = data.current;
        const forecast = data.forecast;
        const showLocation = this._showLocationInPanel();

        this._latestWeatherData = data;

        this._icon.icon_name = current.icon;
        this._temperatureLabel.text = this._formatCompactTemp(current.temperature);
        this._preferencesItem.label.text = 'Open settings';
        this._locationLabel.text = showLocation ? data.locationName : '';
        this._locationLabel.visible = showLocation;

        const minToday = forecast[0]?.min;
        const maxToday = forecast[0]?.max;

        this._locationItem.label.text = `Location: ${data.locationName} (click for full-day details)`;
        this._summaryItem.label.text = `Condition: ${current.summary}`;
        this._tempItem.label.text =
            `Temperature: ${this._formatTemp(current.temperature)} (feels like ${this._formatTemp(current.feelsLike)})`;
        this._rangeItem.label.text =
            `Today range: ${this._formatTemp(minToday)} to ${this._formatTemp(maxToday)}`;
        this._windItem.label.text = `Wind: ${formatNumber(current.windSpeed)} ${this._windLabel()}`;
        this._humidityItem.label.text = `Humidity: ${formatNumber(current.relativeHumidity)}%`;
        this._applyForecastData(forecast);
        const updatedTimestamp = data.refreshedAt || current.time;
        this._updatedItem.label.text = `Updated: ${formatUpdatedTimestamp(updatedTimestamp)}`;
        this._setStatus('OK');
    }

    _setErrorState(error) {
        const message = error?.message ?? String(error);
        const missingLocation = message.startsWith('Location not configured');

        this._latestWeatherData = null;

        this._icon.icon_name = 'weather-severe-alert-symbolic';
        this._temperatureLabel.text = '--';
        this._locationLabel.text = '';
        this._locationLabel.visible = false;

        this._locationItem.label.text = missingLocation
            ? 'Location: not configured (click for details)'
            : 'Location: unavailable (click for details)';
        this._summaryItem.label.text = missingLocation ? 'Condition: choose a location in settings' : 'Condition: unavailable';
        this._tempItem.label.text = 'Temperature: unavailable';
        this._rangeItem.label.text = 'Today range: unavailable';
        this._windItem.label.text = 'Wind: unavailable';
        this._humidityItem.label.text = 'Humidity: unavailable';
        this._forecastDayItems[0].label.text = 'Today: unavailable';
        this._forecastDayItems[1].label.text = 'Day 2: unavailable';
        this._forecastDayItems[2].label.text = 'Day 3: unavailable';
        this._updatedItem.label.text = 'Updated: unavailable';

        this._preferencesItem.label.text = missingLocation ? 'Set location' : 'Open settings';
        this._setStatus(message);
    }

    async _refreshWeather(manual = false) {
        if (this._refreshInProgress) {
            this._refreshQueued = true;
            if (manual)
                this._resetRefreshTimer();
            return;
        }

        if (manual)
            this._resetRefreshTimer();

        this._refreshInProgress = true;
        this._refreshItem.setSensitive(false);
        this._setStatus(manual ? 'manual refresh in progress...' : 'refresh in progress...');

        try {
            const data = await this._fetchWeather();
            this._applyWeatherData(data);
        } catch (error) {
            log(`[ba-vreme] ${error}`);
            this._setErrorState(error);
        } finally {
            this._refreshItem.setSensitive(true);
            this._refreshInProgress = false;

            if (this._refreshQueued) {
                this._refreshQueued = false;
                this._refreshWeather();
            }
        }
    }

    destroy() {
        this._disconnectSettings();
        this._clearRefreshTimer();

        if (this._detailsDialog) {
            try {
                this._detailsDialog.close();
            } catch (error) {
                log(`[ba-vreme] Failed to close details dialog during destroy: ${error}`);
            }

            try {
                this._detailsDialog.destroy();
            } catch (error) {
                log(`[ba-vreme] Failed to destroy details dialog during destroy: ${error}`);
            }

            this._detailsDialog = null;
        }

        if (this._session) {
            this._session.abort();
            this._session = null;
        }

        super.destroy();
    }
});

let indicator = null;

export default class BaVremeExtension extends Extension {
    _getPanelPosition() {
        const value = this._settings?.get_string('panel-position') ?? 'right';
        return ['left', 'center', 'right'].includes(value) ? value : 'right';
    }

    _addIndicator() {
        indicator = new WeatherIndicator(this);
        Main.panel.addToStatusArea(this.uuid, indicator, 0, this._getPanelPosition());
    }

    _rebuildIndicator() {
        if (indicator) {
            indicator.destroy();
            indicator = null;
        }

        this._addIndicator();
    }

    enable() {
        this._settings = this.getSettings();
        this._panelPositionSignalId = this._settings.connect('changed::panel-position', () => {
            this._rebuildIndicator();
        });

        this._addIndicator();
    }

    disable() {
        if (this._settings && this._panelPositionSignalId) {
            this._settings.disconnect(this._panelPositionSignalId);
            this._panelPositionSignalId = 0;
        }

        this._settings = null;

        if (indicator) {
            indicator.destroy();
            indicator = null;
        }
    }
}
