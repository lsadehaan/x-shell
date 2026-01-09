import { describe, it, expect } from 'vitest';
import { CircularBuffer } from '../src/server/circular-buffer.js';

describe('CircularBuffer', () => {
  it('should append data and retrieve it', () => {
    const buffer = new CircularBuffer(100);
    buffer.append('hello');
    buffer.append(' world');
    expect(buffer.toString()).toBe('hello world');
  });

  it('should track size correctly', () => {
    const buffer = new CircularBuffer(100);
    buffer.append('hello');
    expect(buffer.size()).toBe(5);
    buffer.append(' world');
    expect(buffer.size()).toBe(11);
  });

  it('should discard old data when capacity exceeded', () => {
    const buffer = new CircularBuffer(10);
    buffer.append('12345');
    buffer.append('67890');
    buffer.append('ABCDE');
    // Should keep most recent data within capacity
    expect(buffer.size()).toBeLessThanOrEqual(10);
    expect(buffer.toString()).toContain('ABCDE');
  });

  it('should handle single chunk larger than capacity', () => {
    const buffer = new CircularBuffer(5);
    buffer.append('1234567890');
    expect(buffer.size()).toBe(5);
    expect(buffer.toString()).toBe('67890');
  });

  it('should return limited content with toString(limit)', () => {
    const buffer = new CircularBuffer(100);
    buffer.append('hello world this is a test');
    expect(buffer.toString(5)).toBe(' test');
  });

  it('should return tail correctly', () => {
    const buffer = new CircularBuffer(100);
    buffer.append('hello world');
    expect(buffer.tail(5)).toBe('world');
  });

  it('should clear correctly', () => {
    const buffer = new CircularBuffer(100);
    buffer.append('hello');
    buffer.clear();
    expect(buffer.size()).toBe(0);
    expect(buffer.isEmpty()).toBe(true);
    expect(buffer.toString()).toBe('');
  });

  it('should report capacity', () => {
    const buffer = new CircularBuffer(50);
    expect(buffer.capacity()).toBe(50);
  });

  it('should report chunk count', () => {
    const buffer = new CircularBuffer(100);
    buffer.append('a');
    buffer.append('b');
    buffer.append('c');
    expect(buffer.chunkCount()).toBe(3);
  });

  it('should handle empty append', () => {
    const buffer = new CircularBuffer(100);
    buffer.append('');
    expect(buffer.size()).toBe(0);
    expect(buffer.isEmpty()).toBe(true);
  });
});
