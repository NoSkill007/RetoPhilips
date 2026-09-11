/** Derives a broad region from a country name for the panorama's Región → País → Ciudad hierarchy.
 * All countries in this prototype's dataset and every real capture so far are Latin American; the map
 * itself only draws shapes for the three main countries (Panamá, Brasil, Colombia), but a hospital in
 * any other Latin American country still counts fully everywhere else (filters, lists, aggregations) —
 * it just never highlights a shape on the map. @param {string | null | undefined} country */
export function regionFor(country) {
  if (!country) return null;
  const latinAmerica = new Set([
    'Panamá', 'Colombia', 'Brasil', 'México', 'Chile', 'Argentina', 'Perú', 'Uruguay', 'Ecuador',
    'Bolivia', 'Venezuela', 'Paraguay', 'Costa Rica', 'Guatemala', 'Honduras', 'El Salvador',
    'Nicaragua', 'República Dominicana', 'Cuba', 'Puerto Rico',
  ]);
  return latinAmerica.has(country) ? 'América Latina' : 'Otra región';
}
