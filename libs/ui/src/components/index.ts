/**
 * @file index.ts
 * @description UI Components Module for FrontMCP.
 *
 * Provides reusable UI components for FrontMCP pages including:
 * - Button, Card, Badge, Alert, Avatar, Modal, Table, Form, List components
 * - Zod schemas for all component options (for runtime validation)
 * - Full HTMX support for dynamic interactions
 *
 * @module @frontmcp/ui/components
 */

// Component Schemas (Zod validation)
export * from './button.schema';
export * from './card.schema';
export * from './badge.schema';
export * from './alert.schema';
export * from './avatar.schema';
export * from './modal.schema';
export * from './table.schema';
export * from './form.schema';
export * from './list.schema';

// Button components
export {
  type ButtonVariant,
  type ButtonSize,
  type ButtonOptions,
  type ButtonGroupOptions,
  button,
  buttonGroup,
  primaryButton,
  secondaryButton,
  outlineButton,
  ghostButton,
  dangerButton,
  linkButton,
} from './button';

// Card components
export { type CardVariant, type CardSize, type CardOptions, card, cardGroup } from './card';

// Form components
export {
  type InputType,
  type InputSize,
  type InputState,
  type InputOptions,
  type SelectOption,
  type SelectOptions,
  type TextareaOptions,
  type CheckboxOptions,
  type RadioGroupOptions,
  type FormOptions,
  input,
  select,
  textarea,
  checkbox,
  radioGroup,
  form,
  formRow,
  formSection,
  formActions,
  hiddenInput,
  csrfInput,
} from './form';

// Badge components
export {
  type BadgeVariant,
  type BadgeSize,
  type BadgeOptions,
  badge,
  badgeGroup,
  activeBadge,
  inactiveBadge,
  pendingBadge,
  errorBadge,
  newBadge,
  betaBadge,
  onlineDot,
  offlineDot,
  busyDot,
  awayDot,
} from './badge';

// Alert components
export {
  type AlertVariant,
  type AlertOptions,
  type ToastOptions,
  alert,
  infoAlert,
  successAlert,
  warningAlert,
  dangerAlert,
  toast,
  toastContainer,
} from './alert';

// Avatar components
export {
  type AvatarSize,
  type AvatarShape,
  type AvatarStatus,
  type AvatarOptions,
  type AvatarGroupOptions,
  type AvatarWithTextOptions,
  avatar,
  avatarGroup,
  avatarWithText,
} from './avatar';

// Modal components
export {
  type ModalSize,
  type ModalOptions,
  type ConfirmModalOptions,
  type DrawerPosition,
  type DrawerOptions,
  modal,
  modalTrigger,
  confirmModal,
  drawer,
} from './modal';

// Table components
export { type TableColumn, type TableOptions, type PaginationOptions, table, pagination } from './table';

// List components
export {
  type PermissionItem,
  type FeatureItem,
  type DescriptionItem,
  type PermissionListOptions,
  type FeatureListOptions,
  type DescriptionListOptions,
  type ActionItem,
  permissionList,
  featureList,
  descriptionList,
  actionList,
} from './list';
