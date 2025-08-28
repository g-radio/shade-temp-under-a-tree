import { Component, ChangeDetectionStrategy, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';

type WeatherUnit = 'imperial' | 'metric';

interface WeatherApiResponse {
  current: {
    temperature_2m: number;
    relative_humidity_2m: number;
    wind_speed_10m: number;
  };
}

interface NominatimResponse {
  lat: string;
  lon: string;
  display_name: string;
}

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
})
export class AppComponent {
  private http = inject(HttpClient);

  isLoading = signal(false);
  errorMessage = signal<string | null>(null);
  units = signal<WeatherUnit>('imperial');
  searchQuery = signal('');

  // Input signals based on the selected unit system
  airTemperatureC = signal(24);
  airTemperatureF = signal(75);
  humidity = signal(60); // in %
  windSpeedMph = signal(5);
  windSpeedKph = signal(8);

  // Computed signal to get the current temperature based on the selected unit
  airTemperature = computed(() => {
    return this.units() === 'imperial' ? this.airTemperatureF() : this.airTemperatureC();
  });

  // Heat Index Calculation (Feels like temperature in the shade)
  // Based on the NWS formula, simplified for this context.
  feelsLikeInShade = computed(() => {
    const T = this.airTemperatureF(); // Calculation is based on Fahrenheit
    const R = this.humidity();

    if (T < 80) {
      // Heat index is not significant below 80°F. We can add a small wind chill effect.
      let feelsLike = T - (this.windSpeedMph() / 4);
      return this.units() === 'imperial' ? feelsLike : this.toCelsius(feelsLike);
    }
    
    // NWS Heat Index formula (Steadman formula)
    let hi = 0.5 * (T + 61.0 + ((T - 68.0) * 1.2) + (R * 0.094));

    if (hi >= 80) {
        hi = -42.379 + 2.04901523 * T + 10.14333127 * R - 0.22475541 * T * R - 6.83783e-3 * T * T - 5.481717e-2 * R * R + 1.22874e-3 * T * T * R + 8.5282e-4 * T * R * R - 1.99e-6 * T * T * R * R;
        if (R < 13 && T >= 80 && T <= 112) {
            hi -= ((13 - R) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17);
        }
        if (R > 85 && T >= 80 && T <= 87) {
            hi += ((R - 85) / 10) * ((87 - T) / 5);
        }
    }

    // Apply wind cooling effect
    const windCoolingFactor = this.windSpeedMph() / 5;
    const finalFeelsLike = hi - windCoolingFactor;

    return this.units() === 'imperial' ? finalFeelsLike : this.toCelsius(finalFeelsLike);
  });

  // In direct sunlight, the perceived temperature increases due to solar radiation.
  // This is an approximation, adding about 15°F.
  feelsLikeInSun = computed(() => {
    const shadeTempF = this.units() === 'imperial' ? this.feelsLikeInShade() : this.toFahrenheit(this.feelsLikeInShade());
    const sunTempF = shadeTempF + 15;
    return this.units() === 'imperial' ? sunTempF : this.toCelsius(sunTempF);
  });
  
  onSearchQueryInput(event: Event) {
    this.searchQuery.set((event.target as HTMLInputElement).value);
  }

  searchLocation(): void {
    const query = this.searchQuery().trim();
    if (!query) return;

    this.isLoading.set(true);
    this.errorMessage.set(null);

    const apiUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;
    
    this.http.get<NominatimResponse[]>(apiUrl).subscribe({
      next: (data) => {
        if (data && data.length > 0) {
          const location = data[0];
          this.getWeatherForCoordinates(parseFloat(location.lat), parseFloat(location.lon));
        } else {
          this.errorMessage.set(`Could not find location: "${query}". Please try a different search.`);
          this.isLoading.set(false);
        }
      },
      error: () => {
        this.errorMessage.set('Failed to search for location. The search service might be unavailable.');
        this.isLoading.set(false);
      }
    });
  }

  fetchWeatherForCurrentLocation(): void {
    this.isLoading.set(true);
    this.errorMessage.set(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        this.getWeatherForCoordinates(latitude, longitude);
      },
      (error) => {
        let message = 'Could not access location. Please enable location services in your browser.';
        if (error.code === error.PERMISSION_DENIED) {
          message = 'Location access was denied. Please allow location access to use this feature.';
        }
        this.errorMessage.set(message);
        this.isLoading.set(false);
      }
    );
  }

  private getWeatherForCoordinates(latitude: number, longitude: number): void {
    const tempUnit = this.units() === 'imperial' ? 'fahrenheit' : 'celsius';
    const windUnit = this.units() === 'imperial' ? 'mph' : 'kmh';
    const apiUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m&temperature_unit=${tempUnit}&wind_speed_unit=${windUnit}`;

    this.http.get<WeatherApiResponse>(apiUrl).subscribe({
      next: (data) => {
        const temp = data.current.temperature_2m;
        this.humidity.set(data.current.relative_humidity_2m);
        const wind = data.current.wind_speed_10m;

        if (this.units() === 'imperial') {
          this.airTemperatureF.set(temp);
          this.airTemperatureC.set(this.toCelsius(temp));
          this.windSpeedMph.set(wind);
          this.windSpeedKph.set(wind * 1.60934);
        } else {
          this.airTemperatureC.set(temp);
          this.airTemperatureF.set(this.toFahrenheit(temp));
          this.windSpeedKph.set(wind);
          this.windSpeedMph.set(wind / 1.60934);
        }
        this.isLoading.set(false);
      },
      error: () => {
        this.errorMessage.set('Failed to fetch weather data. Please try again or use manual input.');
        this.isLoading.set(false);
      },
    });
  }

  // --- Event Handlers for UI ---
  setUnits(unit: WeatherUnit) {
    this.units.set(unit);
  }
  
  onTempChange(event: Event) {
    const value = parseFloat((event.target as HTMLInputElement).value);
    if (this.units() === 'imperial') {
      this.airTemperatureF.set(value);
      this.airTemperatureC.set(this.toCelsius(value));
    } else {
      this.airTemperatureC.set(value);
      this.airTemperatureF.set(this.toFahrenheit(value));
    }
  }

  onHumidityChange(event: Event) {
    this.humidity.set(parseFloat((event.target as HTMLInputElement).value));
  }

  onWindChange(event: Event) {
    const value = parseFloat((event.target as HTMLInputElement).value);
    if (this.units() === 'imperial') {
      this.windSpeedMph.set(value);
      this.windSpeedKph.set(value * 1.60934);
    } else {
      this.windSpeedKph.set(value);
      this.windSpeedMph.set(value / 1.60934);
    }
  }

  // --- Unit Conversion Helpers ---
  private toCelsius(fahrenheit: number): number {
    return (fahrenheit - 32) * 5 / 9;
  }

  private toFahrenheit(celsius: number): number {
    return celsius * 9 / 5 + 32;
  }
}
