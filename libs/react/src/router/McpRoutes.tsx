/**
 * McpRoutes — auto-generates Route elements for tools, resources, and prompts.
 *
 * Usage:
 * ```tsx
 * <BrowserRouter>
 *   <McpRoutes basePath="/mcp" />
 * </BrowserRouter>
 * ```
 */

import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { ToolRoute } from './ToolRoute';
import { ResourceRoute } from './ResourceRoute';
import { PromptRoute } from './PromptRoute';

export interface McpRoutesProps {
  basePath?: string;
}

export function McpRoutes({ basePath = '/mcp' }: McpRoutesProps): React.ReactElement {
  return React.createElement(
    Routes,
    null,
    React.createElement(Route, { path: `${basePath}/tools/:name`, element: React.createElement(ToolRoute) }),
    React.createElement(Route, { path: `${basePath}/resources/*`, element: React.createElement(ResourceRoute) }),
    React.createElement(Route, { path: `${basePath}/prompts/:name`, element: React.createElement(PromptRoute) }),
  );
}
