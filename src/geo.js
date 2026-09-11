/** Local coordinate lookup for the regional map. Never calls the network — every value is a fixed
 * centroid baked into this file. City names are matched case- and accent-insensitively; a city not
 * in the table falls back to its country's centroid, and an unknown country returns null so the
 * hospital still appears in every list/filter/panorama total, just not on the map. */

/** @param {string} value @returns {string} */
function normalize(value) {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Country centroids (approximate, for the "country-only" fallback). */
const countryCentroids = {
  'panamá': [8.99, -79.52], 'colombia': [4.57, -74.3], 'brasil': [-14.24, -51.93],
  'méxico': [23.63, -102.55], 'chile': [-35.68, -71.54], 'argentina': [-38.42, -63.62],
  'perú': [-9.19, -75.02], 'uruguay': [-32.52, -55.77], 'ecuador': [-1.83, -78.18],
  'bolivia': [-16.29, -63.59], 'venezuela': [6.42, -66.59], 'paraguay': [-23.44, -58.44],
  'costa rica': [9.75, -83.75], 'guatemala': [15.78, -90.23], 'honduras': [15.2, -86.24],
  'el salvador': [13.79, -88.9], 'nicaragua': [12.87, -85.21], 'república dominicana': [18.74, -70.16],
  'cuba': [21.52, -77.78], 'puerto rico': [18.22, -66.59],
};

/** City centroids keyed by normalized "city, country" so the same city name in two countries never
 * collides. Covers the 12 fictional dataset hospitals plus major cities across the region. */
const cityCentroids = {
  'ciudad de panamá|panamá': [8.9824, -79.5199],
  'david|panamá': [8.4273, -82.4310],
  'colón|panamá': [9.3547, -79.9014],
  'são paulo|brasil': [-23.5505, -46.6333],
  'curitiba|brasil': [-25.4284, -49.2733],
  'recife|brasil': [-8.0476, -34.8770],
  'rio de janeiro|brasil': [-22.9068, -43.1729],
  'brasília|brasil': [-15.7939, -47.8828],
  'salvador|brasil': [-12.9777, -38.5016],
  'belo horizonte|brasil': [-19.9167, -43.9345],
  'porto alegre|brasil': [-30.0346, -51.2177],
  'bogotá|colombia': [4.7110, -74.0721],
  'medellín|colombia': [6.2442, -75.5812],
  'cali|colombia': [3.4516, -76.5320],
  'barranquilla|colombia': [10.9639, -74.7964],
  'cartagena|colombia': [10.3910, -75.4794],
  'ciudad de méxico|méxico': [19.4326, -99.1332],
  'guadalajara|méxico': [20.6597, -103.3496],
  'monterrey|méxico': [25.6866, -100.3161],
  'santiago|chile': [-33.4489, -70.6693],
  'valparaíso|chile': [-33.0472, -71.6127],
  'concepción|chile': [-36.8201, -73.0444],
  'buenos aires|argentina': [-34.6037, -58.3816],
  'córdoba|argentina': [-31.4201, -64.1888],
  'rosario|argentina': [-32.9468, -60.6393],
  'lima|perú': [-12.0464, -77.0428],
  'arequipa|perú': [-16.4090, -71.5375],
  'montevideo|uruguay': [-34.9011, -56.1645],
  'quito|ecuador': [-0.1807, -78.4678],
  'guayaquil|ecuador': [-2.1894, -79.8891],
  'la paz|bolivia': [-16.5000, -68.1500],
  'santa cruz de la sierra|bolivia': [-17.7833, -63.1821],
  'caracas|venezuela': [10.4806, -66.9036],
  'asunción|paraguay': [-25.2637, -57.5759],
  'san josé|costa rica': [9.9281, -84.0907],
  'ciudad de guatemala|guatemala': [14.6349, -90.5069],
  'tegucigalpa|honduras': [14.0723, -87.1921],
  'san salvador|el salvador': [13.6929, -89.2182],
  'managua|nicaragua': [12.1364, -86.2514],
  'santo domingo|república dominicana': [18.4861, -69.9312],
  'la habana|cuba': [23.1136, -82.3666],
  'san juan|puerto rico': [18.4655, -66.1057],
};

/** Keys and country names in the tables above are written with their natural accents for
 * readability; normalize them once at module load so lookups can compare normalized-to-normalized. */
const normalizedCityCentroids = Object.fromEntries(
  Object.entries(cityCentroids).map(([key, value]) => [normalize(key), value]),
);
const normalizedCountryCentroids = Object.fromEntries(
  Object.entries(countryCentroids).map(([key, value]) => [normalize(key), value]),
);

/** @param {string | null | undefined} city @param {string | null | undefined} country
 * @returns {{lat: number, lng: number, precision: 'city' | 'country'} | null} */
export function coordinatesFor(city, country) {
  const normalizedCountry = country ? normalize(country) : '';
  if (city && normalizedCountry) {
    const key = `${normalize(city)}|${normalizedCountry}`;
    const cityMatch = normalizedCityCentroids[key];
    if (cityMatch) return { lat: cityMatch[0], lng: cityMatch[1], precision: 'city' };
  }
  if (normalizedCountry) {
    const countryMatch = normalizedCountryCentroids[normalizedCountry];
    if (countryMatch) return { lat: countryMatch[0], lng: countryMatch[1], precision: 'country' };
  }
  return null;
}
