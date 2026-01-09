/**
 * Circular buffer for storing terminal history.
 *
 * Efficiently stores a fixed-size rotating buffer of terminal output,
 * automatically discarding oldest content when capacity is exceeded.
 */

export class CircularBuffer {
  private buffer: string[] = [];
  private maxSize: number;
  private currentSize = 0;

  /**
   * Create a new circular buffer.
   * @param maxSize Maximum size in characters
   */
  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  /**
   * Append data to the buffer.
   * If the buffer exceeds capacity, oldest data is removed.
   * @param data The string data to append
   */
  append(data: string): void {
    if (!data) return;

    this.buffer.push(data);
    this.currentSize += data.length;

    // Trim from front if over capacity
    while (this.currentSize > this.maxSize && this.buffer.length > 1) {
      const removed = this.buffer.shift()!;
      this.currentSize -= removed.length;
    }

    // Handle edge case: single chunk larger than maxSize
    if (this.buffer.length === 1 && this.currentSize > this.maxSize) {
      const chunk = this.buffer[0];
      this.buffer[0] = chunk.slice(-this.maxSize);
      this.currentSize = this.buffer[0].length;
    }
  }

  /**
   * Get buffer contents as a string.
   * @param limit Optional limit on the number of characters to return (from end)
   * @returns The buffer contents
   */
  toString(limit?: number): string {
    const content = this.buffer.join('');
    if (limit && limit > 0 && content.length > limit) {
      return content.slice(-limit);
    }
    return content;
  }

  /**
   * Get the last N characters from the buffer.
   * @param n Number of characters to retrieve
   * @returns The last N characters
   */
  tail(n: number): string {
    return this.toString(n);
  }

  /**
   * Clear the buffer.
   */
  clear(): void {
    this.buffer = [];
    this.currentSize = 0;
  }

  /**
   * Get current size of the buffer in characters.
   */
  size(): number {
    return this.currentSize;
  }

  /**
   * Get the maximum size of the buffer.
   */
  capacity(): number {
    return this.maxSize;
  }

  /**
   * Check if the buffer is empty.
   */
  isEmpty(): boolean {
    return this.currentSize === 0;
  }

  /**
   * Get the number of chunks in the buffer.
   */
  chunkCount(): number {
    return this.buffer.length;
  }
}
