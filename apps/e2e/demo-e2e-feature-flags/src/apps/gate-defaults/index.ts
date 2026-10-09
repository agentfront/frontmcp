import FeatureFlagPlugin from '@frontmcp/plugin-feature-flags';
import { App } from '@frontmcp/sdk';

import {
  GateDefaultAccessorTool,
  GateDefaultKnownOffTool,
  GateDefaultOpenTool,
  GateDefaultRefClosedTool,
} from './tools/gate-default.tools';

/**
 * An app whose FeatureFlagPlugin opts its gates into failing open (`gateDefaultValue: true`) while
 * leaving `this.featureFlags.isEnabled()` on its own default (#719).
 */
@App({
  name: 'gate-defaults',
  plugins: [
    FeatureFlagPlugin.init({
      adapter: 'static',
      flags: { 'gate-known-off': false },
      gateDefaultValue: true,
    }),
  ],
  tools: [GateDefaultOpenTool, GateDefaultRefClosedTool, GateDefaultKnownOffTool, GateDefaultAccessorTool],
})
export class GateDefaultsApp {}
