// file: libs/browser/src/components/layout/index.ts
/**
 * Layout Components
 *
 * Flexbox and Grid-based layout components for building
 * responsive UIs with configurable spacing and alignment.
 */

// Types
export * from './types';

// Components
export { Stack, type StackProps, type StackDirection } from './Stack';
export { Grid, GridItem, type GridProps, type GridItemProps } from './Grid';
export {
  Container,
  Section,
  type ContainerProps,
  type SectionProps,
  type ContainerSize,
  CONTAINER_SIZES,
} from './Container';
