/**
 * Ring Buffer - Fixed-size circular buffer
 *
 * Automatically drops oldest items when capacity is exceeded.
 * Useful for log buffers, request history, etc.
 */

export class RingBuffer<T> {
  private items: T[] = [];

  constructor(private readonly maxSize: number) {
    if (maxSize < 1) {
      throw new Error('RingBuffer maxSize must be at least 1');
    }
  }

  /**
   * Add an item to the buffer.
   * Oldest item is removed if buffer is full.
   */
  push(item: T): void {
    if (this.items.length >= this.maxSize) {
      this.items.shift();
    }
    this.items.push(item);
  }

  /**
   * Add multiple items to the buffer.
   */
  pushMany(items: T[]): void {
    for (const item of items) {
      this.push(item);
    }
  }

  /**
   * Get all items in order (oldest first).
   */
  getAll(): T[] {
    return [...this.items];
  }

  /**
   * Get the most recent N items.
   */
  getRecent(n: number): T[] {
    return this.items.slice(-n);
  }

  /**
   * Get the oldest N items.
   */
  getOldest(n: number): T[] {
    return this.items.slice(0, n);
  }

  /**
   * Get item at index (0 = oldest).
   */
  get(index: number): T | undefined {
    return this.items[index];
  }

  /**
   * Get the most recent item.
   */
  last(): T | undefined {
    return this.items[this.items.length - 1];
  }

  /**
   * Get the oldest item.
   */
  first(): T | undefined {
    return this.items[0];
  }

  /**
   * Clear all items.
   */
  clear(): void {
    this.items = [];
  }

  /**
   * Find items matching a predicate.
   */
  filter(predicate: (item: T) => boolean): T[] {
    return this.items.filter(predicate);
  }

  /**
   * Find first item matching a predicate.
   */
  find(predicate: (item: T) => boolean): T | undefined {
    return this.items.find(predicate);
  }

  /**
   * Check if buffer contains an item matching predicate.
   */
  some(predicate: (item: T) => boolean): boolean {
    return this.items.some(predicate);
  }

  /**
   * Map items to new values.
   */
  map<U>(mapper: (item: T) => U): U[] {
    return this.items.map(mapper);
  }

  /**
   * Iterate over items.
   */
  forEach(callback: (item: T, index: number) => void): void {
    this.items.forEach(callback);
  }

  /**
   * Get the number of items in the buffer.
   */
  get length(): number {
    return this.items.length;
  }

  /**
   * Get the maximum capacity.
   */
  get capacity(): number {
    return this.maxSize;
  }

  /**
   * Check if buffer is empty.
   */
  get isEmpty(): boolean {
    return this.items.length === 0;
  }

  /**
   * Check if buffer is full.
   */
  get isFull(): boolean {
    return this.items.length >= this.maxSize;
  }

  /**
   * Make the buffer iterable.
   */
  [Symbol.iterator](): Iterator<T> {
    return this.items[Symbol.iterator]();
  }
}
