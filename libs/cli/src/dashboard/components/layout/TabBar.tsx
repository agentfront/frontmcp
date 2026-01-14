/**
 * TabBar - Tab navigation component
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { TabName } from '../../store/index.js';

export interface TabBarProps {
  tabs: readonly TabName[];
  labels: Record<TabName, string>;
  activeTab: TabName;
  onTabChange: (tab: TabName) => void;
}

export function TabBar({ tabs, labels, activeTab }: TabBarProps): React.ReactElement {
  return (
    <Box paddingX={1} gap={2}>
      {tabs.map((tab, index) => {
        const isActive = tab === activeTab;
        const label = labels[tab];
        const shortcut = index + 1;

        return (
          <Box key={tab}>
            <Text color={isActive ? 'cyan' : undefined} bold={isActive} dimColor={!isActive}>
              <Text color="gray">{shortcut}</Text> {isActive ? `[${label}]` : label}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
