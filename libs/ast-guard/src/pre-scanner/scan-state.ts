/**
 * Request-scoped scan state for tracking pre-scanner results.
 * Uses the sidecar pattern to collect issues during scanning.
 *
 * @module pre-scanner/scan-state
 */

import type { PreScannerErrorCode } from './errors';

/**
 * Severity levels for pre-scan issues
 */
export type PreScanIssueSeverity = 'error' | 'warning' | 'info';

/**
 * A single issue detected during pre-scanning
 */
export interface PreScanIssue {
  /** Error code identifying the issue type */
  code: PreScannerErrorCode;
  /** Severity level */
  severity: PreScanIssueSeverity;
  /** Human-readable message */
  message: string;
  /** Position in source (byte offset) */
  position?: number;
  /** Line number (1-indexed) */
  line?: number;
  /** Column number (1-indexed) */
  column?: number;
  /** Additional context data */
  data?: Record<string, unknown>;
}

/**
 * Regex pattern found during scanning
 */
export interface DetectedRegex {
  /** The regex pattern (without flags) */
  pattern: string;
  /** Regex flags */
  flags: string;
  /** Position in source */
  position: number;
  /** Line number */
  line: number;
  /** ReDoS vulnerability score (0-100) */
  vulnerabilityScore?: number;
  /** Type of vulnerability if detected */
  vulnerabilityType?: string;
}

/**
 * Statistics collected during pre-scanning
 */
export interface PreScanStats {
  /** Input size in bytes */
  inputSize: number;
  /** Number of lines */
  lineCount: number;
  /** Maximum line length found */
  maxLineLengthFound: number;
  /** Maximum nesting depth found */
  maxNestingDepthFound: number;
  /** Number of regex literals found */
  regexCount: number;
  /** Total string content size */
  totalStringContent: number;
  /** Number of unicode issues found */
  unicodeIssueCount: number;
  /** Scan duration in milliseconds */
  scanDurationMs: number;
}

/**
 * Result of a pre-scan operation
 */
export interface PreScanResult {
  /** Whether the scan passed (no errors) */
  success: boolean;
  /** All issues found (errors, warnings, info) */
  issues: PreScanIssue[];
  /** The fatal issue that caused failure (if any) */
  fatalIssue?: PreScanIssue;
  /** Detected regex patterns (for analysis mode) */
  detectedRegex: DetectedRegex[];
  /** Scan statistics */
  stats: PreScanStats;
}

/**
 * Mutable scan state for collecting results during scanning.
 * This is the "sidecar" that accumulates issues as the scanner runs.
 */
export class ScanState {
  private issues: PreScanIssue[] = [];
  private detectedRegex: DetectedRegex[] = [];
  private fatalIssue?: PreScanIssue;
  private startTime: number;

  // Statistics tracking
  private _inputSize = 0;
  private _lineCount = 0;
  private _maxLineLengthFound = 0;
  private _maxNestingDepthFound = 0;
  private _totalStringContent = 0;
  private _unicodeIssueCount = 0;

  constructor() {
    this.startTime = Date.now();
  }

  /**
   * Report an issue (error/warning/info)
   */
  reportIssue(issue: PreScanIssue): void {
    this.issues.push(issue);
    if (issue.severity === 'error' && !this.fatalIssue) {
      this.fatalIssue = issue;
    }
  }

  /**
   * Report a fatal error that stops scanning
   */
  reportFatalError(issue: Omit<PreScanIssue, 'severity'>): void {
    const fatalIssue = { ...issue, severity: 'error' as const };
    this.issues.push(fatalIssue);
    this.fatalIssue = fatalIssue;
  }

  /**
   * Report a warning
   */
  reportWarning(issue: Omit<PreScanIssue, 'severity'>): void {
    this.issues.push({ ...issue, severity: 'warning' });
  }

  /**
   * Report an info message
   */
  reportInfo(issue: Omit<PreScanIssue, 'severity'>): void {
    this.issues.push({ ...issue, severity: 'info' });
  }

  /**
   * Add a detected regex pattern
   */
  addRegex(regex: DetectedRegex): void {
    this.detectedRegex.push(regex);
  }

  /**
   * Check if scanning should stop (fatal error encountered)
   */
  shouldStop(): boolean {
    return this.fatalIssue !== undefined;
  }

  /**
   * Check if scan is currently passing (no errors)
   */
  isPassing(): boolean {
    return !this.fatalIssue;
  }

  /**
   * Get all issues of a specific severity
   */
  getIssuesBySeverity(severity: PreScanIssueSeverity): PreScanIssue[] {
    return this.issues.filter((i) => i.severity === severity);
  }

  /**
   * Get error count
   */
  getErrorCount(): number {
    return this.issues.filter((i) => i.severity === 'error').length;
  }

  /**
   * Get warning count
   */
  getWarningCount(): number {
    return this.issues.filter((i) => i.severity === 'warning').length;
  }

  // Statistics setters
  setInputSize(size: number): void {
    this._inputSize = size;
  }

  setLineCount(count: number): void {
    this._lineCount = count;
  }

  updateMaxLineLength(length: number): void {
    if (length > this._maxLineLengthFound) {
      this._maxLineLengthFound = length;
    }
  }

  updateMaxNestingDepth(depth: number): void {
    if (depth > this._maxNestingDepthFound) {
      this._maxNestingDepthFound = depth;
    }
  }

  addStringContent(size: number): void {
    this._totalStringContent += size;
  }

  incrementUnicodeIssues(): void {
    this._unicodeIssueCount++;
  }

  /**
   * Finalize and return the scan result
   */
  finalize(): PreScanResult {
    const scanDurationMs = Date.now() - this.startTime;

    return {
      success: this.fatalIssue === undefined,
      issues: [...this.issues],
      fatalIssue: this.fatalIssue,
      detectedRegex: [...this.detectedRegex],
      stats: {
        inputSize: this._inputSize,
        lineCount: this._lineCount,
        maxLineLengthFound: this._maxLineLengthFound,
        maxNestingDepthFound: this._maxNestingDepthFound,
        regexCount: this.detectedRegex.length,
        totalStringContent: this._totalStringContent,
        unicodeIssueCount: this._unicodeIssueCount,
        scanDurationMs,
      },
    };
  }

  /**
   * Create a quick failure result for early termination
   */
  static quickFail(issue: Omit<PreScanIssue, 'severity'>): PreScanResult {
    const fatalIssue = { ...issue, severity: 'error' as const };
    return {
      success: false,
      issues: [fatalIssue],
      fatalIssue,
      detectedRegex: [],
      stats: {
        inputSize: 0,
        lineCount: 0,
        maxLineLengthFound: 0,
        maxNestingDepthFound: 0,
        regexCount: 0,
        totalStringContent: 0,
        unicodeIssueCount: 0,
        scanDurationMs: 0,
      },
    };
  }
}
