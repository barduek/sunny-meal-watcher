import { describe, expect, it } from 'vitest';
import { joinUrl } from './dataUrl';

describe('joinUrl', () => {
  it('une la base de la app con la ruta, sin duplicar barras', () => {
    expect(joinUrl('./', 'data/palermo/index.json')).toBe('./data/palermo/index.json');
    expect(joinUrl('/', '/data/palermo/index.json')).toBe('/data/palermo/index.json');
    expect(joinUrl('/mapa', 'data')).toBe('/mapa/data');
  });

  it('une una base externa (CDN o bucket)', () => {
    expect(joinUrl('https://cdn.example.com/smw/', 'data/palermo')).toBe('https://cdn.example.com/smw/data/palermo');
    expect(joinUrl('https://cdn.example.com/smw', 'data/palermo')).toBe('https://cdn.example.com/smw/data/palermo');
  });

  it('si la ruta ya es una URL absoluta, no la toca', () => {
    expect(joinUrl('./', 'https://otro.com/x.json')).toBe('https://otro.com/x.json');
    expect(joinUrl('./', '//otro.com/x.json')).toBe('//otro.com/x.json');
  });

  it('con base vacía deja la ruta como está', () => {
    expect(joinUrl('', 'data/x.json')).toBe('data/x.json');
  });
});
