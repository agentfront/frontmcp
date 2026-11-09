// file: plugins/plugin-codecall/src/services/tool-tfidf.index.ts

import { defaultTokenizer } from 'vectoriadb';

/** A document of the index: its id, the text it is found by, and what a match returns. */
export interface TfidfIndexDocument<T> {
  id: string;
  text: string;
  metadata: T;
}

export interface TfidfSearchOptions<T> {
  topK: number;
  threshold: number;
  filter?: (metadata: T) => boolean;
}

export interface TfidfSearchResult<T> {
  id: string;
  metadata: T;
  score: number;
}

/** `term` without its plural ending, so `users` and `user`, `policies` and `policy`, `boxes` and `box` are one term. */
export function stemTerm(term: string): string {
  if (term.length <= 3) return term;
  if (term.endsWith('ies')) return `${term.slice(0, -3)}y`;
  if (/(?:x|ch|sh|ss)es$/.test(term)) return term.slice(0, -2);
  if (!term.endsWith('s') || /(?:ss|us|is)$/.test(term)) return term;
  return term.slice(0, -1);
}

function dotProduct(left: Map<string, number>, right: Map<string, number>): number {
  let sum = 0;
  for (const [term, weight] of left) {
    sum += weight * (right.get(term) ?? 0);
  }
  return sum;
}

/**
 * TF-IDF search with cosine similarity over stemmed terms, without `stopWords`. The IDF is smoothed,
 * `ln((1 + N) / (1 + df)) + 1`, so the terms of a server's only tool, and a term every tool has, still count:
 * `ln(N / df)` gave them 0.
 */
export class ToolTfidfIndex<T> {
  private readonly idf = new Map<string, number>();
  private readonly vectors = new Map<string, { metadata: T; vector: Map<string, number> }>();

  constructor(
    documents: readonly TfidfIndexDocument<T>[] = [],
    private readonly stopWords: ReadonlySet<string> = new Set(),
  ) {
    const termsOf = documents.map((document) => this.tokenize(document.text));
    const documentFrequency = new Map<string, number>();
    for (const terms of termsOf) {
      for (const term of new Set(terms)) {
        documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
      }
    }
    for (const [term, frequency] of documentFrequency) {
      this.idf.set(term, Math.log((1 + documents.length) / (1 + frequency)) + 1);
    }
    documents.forEach((document, index) => {
      this.vectors.set(document.id, { metadata: document.metadata, vector: this.vectorOf(termsOf[index]) });
    });
  }

  search(query: string, { topK, threshold, filter }: TfidfSearchOptions<T>): TfidfSearchResult<T>[] {
    const queryVector = this.vectorOf(this.tokenize(query));
    const results: TfidfSearchResult<T>[] = [];
    for (const [id, { metadata, vector }] of this.vectors) {
      if (filter && !filter(metadata)) continue;
      const score = dotProduct(queryVector, vector);
      if (score >= threshold) results.push({ id, metadata, score });
    }
    return results.sort((left, right) => right.score - left.score).slice(0, topK);
  }

  getAllDocumentIds(): string[] {
    return [...this.vectors.keys()];
  }

  getDocumentCount(): number {
    return this.vectors.size;
  }

  hasDocument(id: string): boolean {
    return this.vectors.has(id);
  }

  private tokenize(text: string): string[] {
    return defaultTokenizer(text)
      .filter((term) => !this.stopWords.has(term))
      .map(stemTerm);
  }

  /** The unit-length TF-IDF vector of `terms`; a term no document has is left out. */
  private vectorOf(terms: readonly string[]): Map<string, number> {
    const vector = new Map<string, number>();
    for (const term of terms) {
      const idf = this.idf.get(term);
      if (idf !== undefined) vector.set(term, (vector.get(term) ?? 0) + idf);
    }
    const norm = Math.sqrt([...vector.values()].reduce((sum, weight) => sum + weight * weight, 0));
    for (const [term, weight] of vector) {
      vector.set(term, weight / norm);
    }
    return vector;
  }
}
