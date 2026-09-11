import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coordinatesFor } from '../src/geo.js';

test('ciudad conocida devuelve coordenadas con precisión de ciudad', () => {
  const result = coordinatesFor('São Paulo', 'Brasil');
  assert.equal(result?.precision, 'city');
  assert.equal(result?.lat, -23.5505);
  assert.equal(result?.lng, -46.6333);
});

test('la coincidencia de ciudad ignora acentos y mayúsculas', () => {
  const accented = coordinatesFor('São Paulo', 'Brasil');
  const plain = coordinatesFor('sao paulo', 'BRASIL');
  assert.deepEqual(plain, accented);
});

test('ciudad desconocida con país conocido cae al centroide del país', () => {
  const result = coordinatesFor('Ciudad Ficticia Sin Registro', 'Brasil');
  assert.equal(result?.precision, 'country');
  assert.equal(result?.lat, -14.24);
  assert.equal(result?.lng, -51.93);
});

test('sin ciudad pero con país conocido devuelve el centroide del país', () => {
  const result = coordinatesFor(null, 'México');
  assert.equal(result?.precision, 'country');
});

test('país desconocido devuelve null', () => {
  assert.equal(coordinatesFor('Cualquier ciudad', 'País Inexistente'), null);
  assert.equal(coordinatesFor(null, null), null);
});
