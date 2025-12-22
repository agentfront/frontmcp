/**
 * Progress and Status Widgets
 *
 * Components for displaying progress, loading states, and status information.
 */

import { escapeHtml } from '../layouts/base';

// ============================================
// Progress Bar
// ============================================

/**
 * Progress bar options
 */
export interface ProgressBarOptions {
  /** Progress value (0-100) */
  value: number;
  /** Show percentage text */
  showLabel?: boolean;
  /** Label position */
  labelPosition?: 'inside' | 'outside' | 'none';
  /** Size */
  size?: 'sm' | 'md' | 'lg';
  /** Color variant */
  variant?: 'primary' | 'success' | 'warning' | 'danger' | 'info';
  /** Animated (striped) */
  animated?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Custom label */
  label?: string;
}

/**
 * Build a progress bar
 */
export function progressBar(options: ProgressBarOptions): string {
  const {
    value,
    showLabel = true,
    labelPosition = 'outside',
    size = 'md',
    variant = 'primary',
    animated = false,
    className = '',
    label,
  } = options;

  const clampedValue = Math.min(100, Math.max(0, value));

  const sizeClasses: Record<string, string> = {
    sm: 'h-1.5',
    md: 'h-2.5',
    lg: 'h-4',
  };

  const variantClasses: Record<string, string> = {
    primary: 'bg-primary',
    success: 'bg-success',
    warning: 'bg-warning',
    danger: 'bg-danger',
    info: 'bg-blue-500',
  };

  const animatedClass = animated ? 'bg-stripes animate-stripes' : '';

  const displayLabel = label || `${Math.round(clampedValue)}%`;

  const insideLabel =
    labelPosition === 'inside' && size === 'lg' && clampedValue > 10
      ? `<span class="absolute inset-0 flex items-center justify-center text-xs font-medium text-white">${escapeHtml(
          displayLabel,
        )}</span>`
      : '';

  const outsideLabel =
    showLabel && labelPosition === 'outside'
      ? `<div class="flex justify-between mb-1">
        <span class="text-sm font-medium text-text-primary">${label ? escapeHtml(label) : 'Progress'}</span>
        <span class="text-sm text-text-secondary">${Math.round(clampedValue)}%</span>
      </div>`
      : '';

  return `<div class="progress-bar ${className}">
    ${outsideLabel}
    <div class="relative w-full ${sizeClasses[size]} bg-gray-200 rounded-full overflow-hidden">
      <div
        class="${variantClasses[variant]} ${
    sizeClasses[size]
  } ${animatedClass} rounded-full transition-all duration-300"
        style="width: ${clampedValue}%"
        role="progressbar"
        aria-valuenow="${clampedValue}"
        aria-valuemin="0"
        aria-valuemax="100"
      ></div>
      ${insideLabel}
    </div>
  </div>
  ${
    animated
      ? `<style>
    .bg-stripes {
      background-image: linear-gradient(
        45deg,
        rgba(255,255,255,0.15) 25%,
        transparent 25%,
        transparent 50%,
        rgba(255,255,255,0.15) 50%,
        rgba(255,255,255,0.15) 75%,
        transparent 75%,
        transparent
      );
      background-size: 1rem 1rem;
    }
    @keyframes stripes {
      from { background-position: 1rem 0; }
      to { background-position: 0 0; }
    }
    .animate-stripes {
      animation: stripes 1s linear infinite;
    }
  </style>`
      : ''
  }`;
}

// ============================================
// Multi-Step Progress
// ============================================

/**
 * Step definition
 */
export interface Step {
  /** Step label */
  label: string;
  /** Step description */
  description?: string;
  /** Step status */
  status: 'completed' | 'current' | 'upcoming';
  /** Icon (optional) */
  icon?: string;
  /** URL for clickable steps */
  href?: string;
}

/**
 * Multi-step progress options
 */
export interface StepProgressOptions {
  /** Steps */
  steps: Step[];
  /** Orientation */
  orientation?: 'horizontal' | 'vertical';
  /** Connector style */
  connector?: 'line' | 'dashed' | 'none';
  /** Additional CSS classes */
  className?: string;
}

/**
 * Build a multi-step progress indicator
 */
export function stepProgress(options: StepProgressOptions): string {
  const { steps, orientation = 'horizontal', connector = 'line', className = '' } = options;

  const getStepIcon = (step: Step, index: number): string => {
    if (step.icon) return step.icon;

    if (step.status === 'completed') {
      return `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
      </svg>`;
    }

    return `<span class="font-medium">${index + 1}</span>`;
  };

  const getStepClasses = (status: Step['status']): { circle: string; text: string } => {
    switch (status) {
      case 'completed':
        return {
          circle: 'bg-success text-white',
          text: 'text-text-primary',
        };
      case 'current':
        return {
          circle: 'bg-primary text-white ring-4 ring-primary/20',
          text: 'text-primary font-medium',
        };
      case 'upcoming':
      default:
        return {
          circle: 'bg-gray-200 text-gray-500',
          text: 'text-text-secondary',
        };
    }
  };

  if (orientation === 'vertical') {
    const stepsHtml = steps
      .map((step, index) => {
        const classes = getStepClasses(step.status);
        const isLast = index === steps.length - 1;

        const connectorHtml =
          !isLast && connector !== 'none'
            ? `<div class="ml-5 w-0.5 h-8 ${
                connector === 'dashed' ? 'border-l-2 border-dashed border-gray-300' : 'bg-gray-200'
              } ${step.status === 'completed' ? 'bg-success' : ''}"></div>`
            : '';

        const stepContent = `
        <div class="flex items-start gap-4">
          <div class="w-10 h-10 rounded-full ${classes.circle} flex items-center justify-center flex-shrink-0">
            ${getStepIcon(step, index)}
          </div>
          <div class="pt-2">
            <div class="${classes.text}">${escapeHtml(step.label)}</div>
            ${
              step.description
                ? `<p class="text-sm text-text-secondary mt-0.5">${escapeHtml(step.description)}</p>`
                : ''
            }
          </div>
        </div>
        ${connectorHtml}
      `;

        return step.href && step.status === 'completed'
          ? `<a href="${escapeHtml(step.href)}" class="block hover:opacity-80">${stepContent}</a>`
          : `<div>${stepContent}</div>`;
      })
      .join('\n');

    return `<div class="step-progress ${className}">${stepsHtml}</div>`;
  }

  // Horizontal orientation
  const stepsHtml = steps
    .map((step, index) => {
      const classes = getStepClasses(step.status);
      const isLast = index === steps.length - 1;

      const connectorHtml =
        !isLast && connector !== 'none'
          ? `<div class="flex-1 h-0.5 mx-2 ${
              connector === 'dashed' ? 'border-t-2 border-dashed border-gray-300' : 'bg-gray-200'
            } ${step.status === 'completed' ? 'bg-success' : ''}"></div>`
          : '';

      const stepHtml = `
      <div class="flex flex-col items-center">
        <div class="w-10 h-10 rounded-full ${classes.circle} flex items-center justify-center">
          ${getStepIcon(step, index)}
        </div>
        <div class="mt-2 text-center">
          <div class="${classes.text} text-sm">${escapeHtml(step.label)}</div>
          ${
            step.description
              ? `<p class="text-xs text-text-secondary mt-0.5 max-w-[120px]">${escapeHtml(step.description)}</p>`
              : ''
          }
        </div>
      </div>
    `;

      const clickableStep =
        step.href && step.status === 'completed'
          ? `<a href="${escapeHtml(step.href)}" class="hover:opacity-80">${stepHtml}</a>`
          : stepHtml;

      return `${clickableStep}${connectorHtml}`;
    })
    .join('\n');

  return `<div class="step-progress flex items-start ${className}">${stepsHtml}</div>`;
}

// ============================================
// Circular Progress
// ============================================

/**
 * Circular progress options
 */
export interface CircularProgressOptions {
  /** Progress value (0-100) */
  value: number;
  /** Size in pixels */
  size?: number;
  /** Stroke width */
  strokeWidth?: number;
  /** Color variant */
  variant?: 'primary' | 'success' | 'warning' | 'danger';
  /** Show percentage */
  showLabel?: boolean;
  /** Custom label */
  label?: string;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Build a circular progress indicator
 */
export function circularProgress(options: CircularProgressOptions): string {
  const { value, size = 80, strokeWidth = 8, variant = 'primary', showLabel = true, label, className = '' } = options;

  const clampedValue = Math.min(100, Math.max(0, value));
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (clampedValue / 100) * circumference;

  const variantColors: Record<string, string> = {
    primary: 'text-primary',
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-danger',
  };

  const displayLabel = label || `${Math.round(clampedValue)}%`;

  return `<div class="circular-progress inline-flex items-center justify-center ${className}" style="width: ${size}px; height: ${size}px;">
    <svg class="transform -rotate-90" width="${size}" height="${size}">
      <!-- Background circle -->
      <circle
        cx="${size / 2}"
        cy="${size / 2}"
        r="${radius}"
        fill="none"
        stroke="currentColor"
        stroke-width="${strokeWidth}"
        class="text-gray-200"
      />
      <!-- Progress circle -->
      <circle
        cx="${size / 2}"
        cy="${size / 2}"
        r="${radius}"
        fill="none"
        stroke="currentColor"
        stroke-width="${strokeWidth}"
        stroke-linecap="round"
        class="${variantColors[variant]}"
        style="stroke-dasharray: ${circumference}; stroke-dashoffset: ${offset}; transition: stroke-dashoffset 0.3s ease;"
      />
    </svg>
    ${
      showLabel
        ? `<span class="absolute text-sm font-semibold text-text-primary">${escapeHtml(displayLabel)}</span>`
        : ''
    }
  </div>`;
}

// ============================================
// Status Indicator
// ============================================

/**
 * Status indicator options
 */
export interface StatusIndicatorOptions {
  /** Status state */
  status: 'online' | 'offline' | 'busy' | 'away' | 'loading' | 'error' | 'success';
  /** Status label */
  label?: string;
  /** Size */
  size?: 'sm' | 'md' | 'lg';
  /** Show pulse animation */
  pulse?: boolean;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Build a status indicator
 */
export function statusIndicator(options: StatusIndicatorOptions): string {
  const { status, label, size = 'md', pulse = false, className = '' } = options;

  const sizeClasses: Record<string, { dot: string; text: string }> = {
    sm: { dot: 'w-2 h-2', text: 'text-xs' },
    md: { dot: 'w-2.5 h-2.5', text: 'text-sm' },
    lg: { dot: 'w-3 h-3', text: 'text-base' },
  };

  const statusClasses: Record<string, { color: string; label: string }> = {
    online: { color: 'bg-success', label: 'Online' },
    offline: { color: 'bg-gray-400', label: 'Offline' },
    busy: { color: 'bg-danger', label: 'Busy' },
    away: { color: 'bg-warning', label: 'Away' },
    loading: { color: 'bg-blue-500', label: 'Loading' },
    error: { color: 'bg-danger', label: 'Error' },
    success: { color: 'bg-success', label: 'Success' },
  };

  const statusInfo = statusClasses[status];
  const sizeInfo = sizeClasses[size];
  const displayLabel = label || statusInfo.label;

  const pulseHtml =
    pulse || status === 'loading'
      ? `<span class="absolute ${sizeInfo.dot} ${statusInfo.color} rounded-full animate-ping opacity-75"></span>`
      : '';

  return `<div class="status-indicator inline-flex items-center gap-2 ${className}">
    <span class="relative flex">
      ${pulseHtml}
      <span class="relative ${sizeInfo.dot} ${statusInfo.color} rounded-full"></span>
    </span>
    ${displayLabel ? `<span class="${sizeInfo.text} text-text-secondary">${escapeHtml(displayLabel)}</span>` : ''}
  </div>`;
}

// ============================================
// Skeleton Loader
// ============================================

/**
 * Skeleton loader options
 */
export interface SkeletonOptions {
  /** Skeleton type */
  type?: 'text' | 'circle' | 'rect' | 'card';
  /** Width (CSS value) */
  width?: string;
  /** Height (CSS value) */
  height?: string;
  /** Number of text lines */
  lines?: number;
  /** Animated */
  animated?: boolean;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Build a skeleton loader
 */
export function skeleton(options: SkeletonOptions = {}): string {
  const { type = 'text', width, height, lines = 3, animated = true, className = '' } = options;

  const animateClass = animated ? 'animate-pulse' : '';
  const baseClass = `bg-gray-200 ${animateClass}`;

  switch (type) {
    case 'circle':
      return `<div class="${baseClass} rounded-full ${className}" style="width: ${width || '40px'}; height: ${
        height || '40px'
      }"></div>`;

    case 'rect':
      return `<div class="${baseClass} rounded ${className}" style="width: ${width || '100%'}; height: ${
        height || '100px'
      }"></div>`;

    case 'card':
      return `<div class="${animateClass} space-y-4 ${className}">
        <div class="bg-gray-200 rounded h-40"></div>
        <div class="space-y-2">
          <div class="bg-gray-200 h-4 rounded w-3/4"></div>
          <div class="bg-gray-200 h-4 rounded w-1/2"></div>
        </div>
      </div>`;

    case 'text':
    default: {
      const linesHtml = Array(lines)
        .fill(0)
        .map((_, i) => {
          const lineWidth = i === lines - 1 ? '60%' : i === 0 ? '90%' : '80%';
          return `<div class="bg-gray-200 h-4 rounded" style="width: ${lineWidth}"></div>`;
        })
        .join('\n');

      return `<div class="${animateClass} space-y-2 ${className}" style="width: ${width || '100%'}">
        ${linesHtml}
      </div>`;
    }
  }
}

/**
 * Build a content skeleton with avatar and text
 */
export function contentSkeleton(options: { animated?: boolean; className?: string } = {}): string {
  const { animated = true, className = '' } = options;
  const animateClass = animated ? 'animate-pulse' : '';

  return `<div class="${animateClass} flex gap-4 ${className}">
    <div class="bg-gray-200 rounded-full w-12 h-12 flex-shrink-0"></div>
    <div class="flex-1 space-y-2 py-1">
      <div class="bg-gray-200 h-4 rounded w-3/4"></div>
      <div class="bg-gray-200 h-4 rounded w-1/2"></div>
    </div>
  </div>`;
}
