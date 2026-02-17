import type { ComponentNode } from '@frontmcp/react';

export const statsTree: ComponentNode = {
  type: 'InfoCard',
  props: { title: 'Server Stats' },
  children: [
    { type: 'StatBox', props: { label: 'Tools', value: 4 } },
    { type: 'StatBox', props: { label: 'Resources', value: 2 } },
    { type: 'StatBox', props: { label: 'Prompts', value: 2 } },
  ],
};

export const alertTree: ComponentNode = {
  type: 'Alert',
  props: { variant: 'info' },
  children: 'This component tree was rendered dynamically via DynamicRenderer.',
};

export const nestedTree: ComponentNode = {
  type: 'InfoCard',
  props: { title: 'Nested Components' },
  children: [
    {
      type: 'Alert',
      props: { variant: 'success' },
      children: 'This is a success alert inside an InfoCard.',
    },
    {
      type: 'Badge',
      props: { label: 'Dynamic', color: 'var(--accent-dim)' },
    },
  ],
};

export const sampleTrees: Record<string, ComponentNode> = {
  'Stats Dashboard': statsTree,
  'Alert Message': alertTree,
  'Nested Components': nestedTree,
};
