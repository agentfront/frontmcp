import { cosineSimilarity } from './similarity.utils';

/**
 * HNSW (Hierarchical Navigable Small World) Index
 * Provides efficient approximate nearest neighbor search
 */

/**
 * Configuration for HNSW index
 */
export interface HNSWConfig {
  /**
   * Maximum number of connections per node in layer > 0
   * @default 16
   */
  M?: number;

  /**
   * Maximum connections for layer 0 (typically M * 2)
   * @default 32
   */
  M0?: number;

  /**
   * Size of dynamic candidate list during construction
   * Higher = better quality, slower construction
   * @default 200
   */
  efConstruction?: number;

  /**
   * Size of dynamic candidate list during search
   * Higher = better recall, slower search
   * @default 50
   */
  efSearch?: number;

  /**
   * Normalization factor for level assignment
   * @default 1 / Math.log(2)
   */
  levelMultiplier?: number;
}

/**
 * Node in the HNSW graph
 */
interface HNSWNode {
  id: string;
  vector: Float32Array;
  level: number;
  connections: Map<number, Set<string>>; // layer -> set of neighbor IDs
}

/**
 * Candidate for nearest neighbor search
 */
interface Candidate {
  id: string;
  distance: number;
}

/**
 * HNSW Index implementation
 */
export class HNSWIndex {
  private nodes: Map<string, HNSWNode>;
  private entryPointId: string | null;
  private config: Required<HNSWConfig>;
  private maxLevel: number;

  constructor(config: HNSWConfig = {}) {
    this.nodes = new Map();
    this.entryPointId = null;
    this.maxLevel = -1;

    this.config = {
      M: config.M ?? 16,
      M0: config.M0 ?? 32,
      efConstruction: config.efConstruction ?? 200,
      efSearch: config.efSearch ?? 50,
      levelMultiplier: config.levelMultiplier ?? 1 / Math.log(2),
    };
  }

  /**
   * Insert a vector into the HNSW index
   */
  insert(id: string, vector: Float32Array): void {
    // Assign random level to new node (exponential decay)
    const level = this.assignLevel();

    // Create new node
    const newNode: HNSWNode = {
      id,
      vector,
      level,
      connections: new Map(),
    };

    // Initialize connection sets for each layer
    for (let lc = 0; lc <= level; lc++) {
      newNode.connections.set(lc, new Set());
    }

    this.nodes.set(id, newNode);

    // If this is the first node, make it the entry point
    if (this.entryPointId === null) {
      this.entryPointId = id;
      this.maxLevel = level;
      return;
    }

    // Find nearest neighbors at each level and connect
    let currentNearest = this.entryPointId;

    // Search from top level down to level + 1
    for (let lc = this.maxLevel; lc > level; lc--) {
      const nearest = this.searchLayer(vector, currentNearest, 1, lc);
      if (nearest.length > 0) {
        currentNearest = nearest[0].id;
      }
    }

    // Search and insert from level down to 0
    for (let lc = level; lc >= 0; lc--) {
      const candidates = this.searchLayer(vector, currentNearest, this.config.efConstruction, lc);

      // Select M neighbors
      const M = lc === 0 ? this.config.M0 : this.config.M;
      const neighbors = this.selectNeighbors(candidates, M);

      // Add bidirectional links
      for (const neighbor of neighbors) {
        const neighborNode = this.nodes.get(neighbor.id);
        if (!neighborNode) {
          continue;
        }

        // Only add connections if both nodes exist at this layer
        this.addConnection(id, neighbor.id, lc);

        // Only add reverse connection if neighbor exists at this layer
        if (neighborNode.level >= lc) {
          this.addConnection(neighbor.id, id, lc);

          // Prune connections if needed
          const neighborConnections = neighborNode.connections.get(lc);
          if (neighborConnections && neighborConnections.size > M) {
            this.pruneConnections(neighbor.id, lc, M);
          }
        }
      }

      if (candidates.length > 0) {
        currentNearest = candidates[0].id;
      }
    }

    // Update entry point if new node has higher level
    if (level > this.maxLevel) {
      this.maxLevel = level;
      this.entryPointId = id;
    }
  }

  /**
   * Search for k nearest neighbors
   */
  search(query: Float32Array, k: number, ef?: number): Candidate[] {
    if (this.entryPointId === null) {
      return [];
    }

    const efSearch = ef ?? this.config.efSearch;
    let currentNearest = this.entryPointId;

    // Search from top level down to level 1
    for (let lc = this.maxLevel; lc > 0; lc--) {
      const nearest = this.searchLayer(query, currentNearest, 1, lc);
      if (nearest.length > 0) {
        currentNearest = nearest[0].id;
      }
    }

    // Search at layer 0 with efSearch
    const candidates = this.searchLayer(query, currentNearest, efSearch, 0);

    // Return top k
    return candidates.slice(0, k);
  }

  /**
   * Remove a node from the index
   */
  remove(id: string): boolean {
    const node = this.nodes.get(id);
    if (!node) {
      return false;
    }

    // Remove all connections to this node
    for (let lc = 0; lc <= node.level; lc++) {
      const connections = node.connections.get(lc)!;
      for (const neighborId of connections) {
        const neighbor = this.nodes.get(neighborId);
        if (neighbor) {
          neighbor.connections.get(lc)?.delete(id);
        }
      }
    }

    // Remove the node
    this.nodes.delete(id);

    // Update entry point if needed
    if (this.entryPointId === id) {
      // Find new entry point (node with highest level)
      let newEntryPoint: string | null = null;
      let newMaxLevel = -1;

      for (const [nodeId, node] of this.nodes) {
        if (node.level > newMaxLevel) {
          newMaxLevel = node.level;
          newEntryPoint = nodeId;
        }
      }

      this.entryPointId = newEntryPoint;
      this.maxLevel = newMaxLevel;
    }

    return true;
  }

  /**
   * Get the number of nodes in the index
   */
  size(): number {
    return this.nodes.size;
  }

  /**
   * Clear all nodes from the index
   */
  clear(): void {
    this.nodes.clear();
    this.entryPointId = null;
    this.maxLevel = -1;
  }

  /**
   * Search within a single layer
   */
  private searchLayer(query: Float32Array, entryPoint: string, ef: number, layer: number): Candidate[] {
    const visited = new Set<string>();
    const candidates: Candidate[] = [];
    const results: Candidate[] = [];

    const entryNode = this.nodes.get(entryPoint);
    if (!entryNode) {
      return [];
    }

    const entryDistance = this.distance(query, entryNode.vector);
    candidates.push({ id: entryPoint, distance: entryDistance });
    results.push({ id: entryPoint, distance: entryDistance });
    visited.add(entryPoint);

    while (candidates.length > 0) {
      // Get closest candidate
      candidates.sort((a, b) => a.distance - b.distance);
      const current = candidates.shift()!;

      // If current is farther than furthest result, stop
      if (results.length >= ef) {
        results.sort((a, b) => a.distance - b.distance);
        if (current.distance > results[ef - 1].distance) {
          break;
        }
      }

      // Explore neighbors
      const currentNode = this.nodes.get(current.id)!;
      const connections = currentNode.connections.get(layer);

      if (connections) {
        for (const neighborId of connections) {
          if (visited.has(neighborId)) {
            continue;
          }
          visited.add(neighborId);

          const neighborNode = this.nodes.get(neighborId);
          if (!neighborNode) {
            continue; // Node was deleted
          }

          const neighborDistance = this.distance(query, neighborNode.vector);

          // Add to results if better than worst result or results not full
          if (results.length < ef || neighborDistance < results[results.length - 1].distance) {
            candidates.push({ id: neighborId, distance: neighborDistance });
            results.push({ id: neighborId, distance: neighborDistance });

            // Keep results sorted and limited to ef
            results.sort((a, b) => a.distance - b.distance);
            if (results.length > ef) {
              results.pop();
            }
          }
        }
      }
    }

    results.sort((a, b) => a.distance - b.distance);
    return results;
  }

  /**
   * Select neighbors using heuristic
   */
  private selectNeighbors(candidates: Candidate[], M: number): Candidate[] {
    // Sort by distance
    candidates.sort((a, b) => a.distance - b.distance);

    // Return top M
    return candidates.slice(0, M);
  }

  /**
   * Prune connections to maintain M limit
   */
  private pruneConnections(nodeId: string, layer: number, M: number): void {
    const node = this.nodes.get(nodeId);
    if (!node) {
      return;
    }

    const connections = node.connections.get(layer)!;
    if (connections.size <= M) {
      return;
    }

    // Calculate distances to all neighbors
    const neighbors: Candidate[] = [];
    for (const neighborId of connections) {
      const neighbor = this.nodes.get(neighborId)!;
      const distance = this.distance(node.vector, neighbor.vector);
      neighbors.push({ id: neighborId, distance });
    }

    // Keep closest M neighbors
    neighbors.sort((a, b) => a.distance - b.distance);
    const toKeep = new Set(neighbors.slice(0, M).map((n) => n.id));

    // Remove connections not in toKeep
    for (const neighborId of connections) {
      if (!toKeep.has(neighborId)) {
        connections.delete(neighborId);
        // Remove reverse connection
        const neighbor = this.nodes.get(neighborId);
        if (neighbor) {
          neighbor.connections.get(layer)?.delete(nodeId);
        }
      }
    }
  }

  /**
   * Add bidirectional connection between two nodes
   */
  private addConnection(fromId: string, toId: string, layer: number): void {
    const fromNode = this.nodes.get(fromId);
    if (!fromNode) {
      return;
    }

    const connections = fromNode.connections.get(layer);
    if (connections) {
      connections.add(toId);
    }
  }

  /**
   * Assign random level using exponential decay
   */
  private assignLevel(): number {
    const randomValue = Math.random();
    return Math.floor(-Math.log(randomValue) * this.config.levelMultiplier);
  }

  /**
   * Calculate distance between two vectors
   * Uses 1 - cosine similarity to convert similarity to distance
   */
  private distance(a: Float32Array, b: Float32Array): number {
    return 1 - cosineSimilarity(a, b);
  }
}
