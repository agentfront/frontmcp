/**
 * Widgets Module
 *
 * Specialized widgets for OpenAI App SDK and common UI patterns.
 */

// Resource widgets
export {
  type ResourceType,
  type ResourceMeta,
  type ResourceAction,
  type ResourceOptions,
  type ResourceListOptions,
  type CodePreviewOptions,
  type ImagePreviewOptions,
  resourceWidget,
  resourceList,
  resourceItem,
  codePreview,
  imagePreview,
} from './resource';

// Progress widgets
export {
  type ProgressBarOptions,
  type Step,
  type StepProgressOptions,
  type CircularProgressOptions,
  type StatusIndicatorOptions,
  type SkeletonOptions,
  progressBar,
  stepProgress,
  circularProgress,
  statusIndicator,
  skeleton,
  contentSkeleton,
} from './progress';
