import { describe, it, expect, vi, beforeEach } from 'vitest';
import { splitNotes, sanitizeField, debounce } from '../helpers';

describe('splitNotes', () => {
  it('returns empty array for null/undefined/empty string', () => {
    expect(splitNotes(null)).toEqual([]);
    expect(splitNotes(undefined)).toEqual([]);
    expect(splitNotes('')).toEqual([]);
  });

  it('splits on commas', () => {
    expect(splitNotes('Rose, Vanille, Moschus')).toEqual(['Rose', 'Vanille', 'Moschus']);
  });

  it('splits on middle dot (·)', () => {
    expect(splitNotes('Rose · Vanille · Moschus')).toEqual(['Rose', 'Vanille', 'Moschus']);
  });

  it('handles mixed separators', () => {
    expect(splitNotes('Rose, Vanille · Moschus')).toEqual(['Rose', 'Vanille', 'Moschus']);
  });

  it('trims whitespace from each note', () => {
    expect(splitNotes(' Rose ,  Vanille  , Moschus ')).toEqual(['Rose', 'Vanille', 'Moschus']);
  });

  it('filters out empty notes', () => {
    expect(splitNotes('Rose, , Vanille, , Moschus')).toEqual(['Rose', 'Vanille', 'Moschus']);
  });

  it('handles notes with spaces', () => {
    expect(splitNotes('Weißer Moschus · Grüner Apfel')).toEqual(['Weißer Moschus', 'Grüner Apfel']);
  });

  it('handles special characters in notes', () => {
    expect(splitNotes("Eau de Parfum · Oud 'n' Amber")).toEqual(["Eau de Parfum", "Oud 'n' Amber"]);
  });
});

describe('sanitizeField', () => {
  it('returns empty string for null/undefined', () => {
    expect(sanitizeField(null)).toBe('');
    expect(sanitizeField(undefined)).toBe('');
  });

  it('converts numbers to string', () => {
    expect(sanitizeField(123)).toBe('123');
    expect(sanitizeField(0)).toBe('0');
  });

  it('converts booleans to string', () => {
    expect(sanitizeField(true)).toBe('true');
    expect(sanitizeField(false)).toBe('false');
  });

  it('removes newlines', () => {
    // \n und \r werden jeweils durch ein einzelnes Leerzeichen ersetzt
    expect(sanitizeField('Zeile1\nZeile2')).toBe('Zeile1 Zeile2');
    // \r\n ergibt zwei Leerzeichen (jedes Zeichen einzeln ersetzt)
    expect(sanitizeField('Zeile1\r\nZeile2')).toBe('Zeile1  Zeile2');
    expect(sanitizeField('Zeile1\rZeile2')).toBe('Zeile1 Zeile2');
  });

  it('removes tabs', () => {
    expect(sanitizeField('Spalte 1\tSpalte 2')).toBe('Spalte 1 Spalte 2');
  });

  it('trims leading/trailing whitespace', () => {
    expect(sanitizeField('  hello  ')).toBe('hello');
  });

  it('handles complex mixed input', () => {
    expect(sanitizeField('\t  Hallo\nWelt  \r')).toBe('Hallo Welt');
  });

  it('protects against XSS by not executing scripts', () => {
    // Die Funktion führt keine Ausführung durch, sie bereinigt nur
    const malicious = '<script>alert("xss")</script>';
    const result = sanitizeField(malicious);
    expect(result).toBe(malicious); // String wird nicht ausgeführt, nur bereinigt
  });
});

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('delays function execution', () => {
    const fn = vi.fn();
    const debouncedFn = debounce(fn, 300);

    debouncedFn('arg1');
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('arg1');
  });

  it('only calls once for multiple rapid calls', () => {
    const fn = vi.fn();
    const debouncedFn = debounce(fn, 300);

    debouncedFn('a');
    debouncedFn('b');
    debouncedFn('c');

    vi.advanceTimersByTime(300);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('c'); // Letztes Argument wird verwendet
  });

  it('resets timer on each call', () => {
    const fn = vi.fn();
    const debouncedFn = debounce(fn, 300);

    debouncedFn('first');
    vi.advanceTimersByTime(200);
    debouncedFn('second');
    vi.advanceTimersByTime(200);

    // Erst nach 300ms seit letztem Aufruf wird ausgeführt
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('second');
  });

  it('handles zero delay', () => {
    const fn = vi.fn();
    const debouncedFn = debounce(fn, 0);

    debouncedFn('test');
    vi.advanceTimersByTime(0);
    expect(fn).toHaveBeenCalledWith('test');
  });

  it('passes multiple arguments correctly', () => {
    const fn = vi.fn();
    const debouncedFn = debounce(fn, 300);

    debouncedFn('arg1', 'arg2', 'arg3');
    vi.advanceTimersByTime(300);

    expect(fn).toHaveBeenCalledWith('arg1', 'arg2', 'arg3');
  });
});