import { describe, expect, it } from 'vitest';
import { PATRON_FECHA, textoConsulta, validarFecha } from '../src/lib/fechas';

describe('lib/fechas', () => {
  it('acepta fechas validas, incluido bisiesto 2028-02-29', () => {
    expect(() => validarFecha('2028-02-29')).not.toThrow();
    expect(() => validarFecha('2026-12-31')).not.toThrow();
    expect(() => validarFecha('2026-01-01')).not.toThrow();
  });

  it('rechaza fechas inexistentes en el calendario', () => {
    expect(() => validarFecha('2026-02-29')).toThrow(
      'La fecha no existe en el calendario',
    );
    expect(() => validarFecha('2026-06-31')).toThrow(
      'La fecha no existe en el calendario',
    );
    expect(() => validarFecha('2026-11-31')).toThrow(
      'La fecha no existe en el calendario',
    );
    expect(() => validarFecha('2026-13-01')).toThrow();
    expect(() => validarFecha('2026-00-10')).toThrow();
    expect(() => validarFecha('2026-05-00')).toThrow();
    expect(() => validarFecha('2026-11-32')).toThrow();
  });

  it('rechaza formato invalido', () => {
    expect(() => validarFecha('16/11/2026')).toThrow(
      'La fecha debe tener formato AAAA-MM-DD',
    );
    expect(() => validarFecha('hola')).toThrow(
      'La fecha debe tener formato AAAA-MM-DD',
    );
    expect(() => validarFecha('2026-1-1')).toThrow();
  });

  it('omite undefined y vacio (semantica de filtros)', () => {
    expect(() => validarFecha(undefined)).not.toThrow();
    expect(() => validarFecha('')).not.toThrow();
  });

  it('nombre de campo personalizable en el mensaje', () => {
    expect(() => validarFecha('x', 'El desde')).toThrow(
      'El desde debe tener formato AAAA-MM-DD',
    );
    expect(() => validarFecha('2026-02-30', 'El hasta')).toThrow(
      'El hasta no existe en el calendario',
    );
  });

  it('PATRON_FECHA es el regex compartido de formato', () => {
    expect(PATRON_FECHA.test('2026-11-12')).toBe(true);
    expect(PATRON_FECHA.test('2026-11-1')).toBe(false);
  });

  it('textoConsulta recorta e ignora cadenas en blanco', () => {
    expect(textoConsulta('  hola ')).toBe('hola');
    expect(textoConsulta('hola')).toBe('hola');
    expect(textoConsulta('')).toBeUndefined();
    expect(textoConsulta('   ')).toBeUndefined();
    expect(textoConsulta(undefined)).toBeUndefined();
    expect(textoConsulta(5)).toBeUndefined();
    expect(textoConsulta(['a', 'b'])).toBeUndefined();
  });
});
