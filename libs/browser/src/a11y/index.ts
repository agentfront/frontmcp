// file: libs/browser/src/a11y/index.ts
/**
 * Accessibility Utilities
 *
 * Utilities for building accessible browser applications including
 * focus management, ARIA helpers, and screen reader announcements.
 */

// Focus management
export {
  FOCUSABLE_SELECTOR,
  TABBABLE_SELECTOR,
  getFocusableElements,
  getTabbableElements,
  isElementVisible,
  createFocusTrap,
  focusFirst,
  focusLast,
  createFocusStore,
  type FocusTrapOptions,
  type FocusTrap,
} from './focus-management';

// ARIA helpers
export {
  generateAriaId,
  ariaDescribedBy,
  ariaLabelledBy,
  ariaControls,
  dialogAriaProps,
  alertDialogAriaProps,
  menuAriaProps,
  menuItemAriaProps,
  tabListAriaProps,
  tabAriaProps,
  tabPanelAriaProps,
  comboboxAriaProps,
  listboxAriaProps,
  optionAriaProps,
  progressAriaProps,
  sliderAriaProps,
  type AriaLive,
  type AriaRole,
  type AriaAttributes,
} from './aria-helpers';

// Announcer
export {
  createAnnouncer,
  getGlobalAnnouncer,
  announce,
  announceAssertive,
  useAnnouncer,
  createVisualAnnouncer,
  type Announcer,
  type AnnouncerOptions,
  type VisualAnnouncer,
  type VisualAnnouncerOptions,
} from './announcer';
