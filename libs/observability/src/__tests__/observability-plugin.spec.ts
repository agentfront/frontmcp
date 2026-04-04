import ObservabilityPlugin from '../plugin/observability.plugin';
import { OTEL_TRACER, OTEL_CONFIG } from '../otel/otel.tokens';
import { REQUEST_LOG_COLLECTOR } from '../request-log/request-log.tokens';
import { StructuredLogTransport } from '../logging/structured-log-transport';

describe('ObservabilityPlugin', () => {
  describe('constructor', () => {
    it('should use default options when none provided', () => {
      const plugin = new ObservabilityPlugin();
      expect(plugin.options.tracing).toEqual(
        expect.objectContaining({
          httpSpans: true,
          executionSpans: true,
          hookSpans: false,
          fetchSpans: true,
          flowStageEvents: true,
        }),
      );
      expect(plugin.options.logging).toBe(false);
      expect(plugin.options.requestLogs).toBe(false);
    });

    it('should resolve tracing: true to default tracing options', () => {
      const plugin = new ObservabilityPlugin({ tracing: true });
      expect(plugin.options.tracing).toEqual(expect.objectContaining({ httpSpans: true, executionSpans: true }));
    });

    it('should resolve tracing: false to false', () => {
      const plugin = new ObservabilityPlugin({ tracing: false });
      expect(plugin.options.tracing).toBe(false);
    });

    it('should merge partial tracing options with defaults', () => {
      const plugin = new ObservabilityPlugin({ tracing: { hookSpans: true } });
      expect(plugin.options.tracing).toEqual({
        httpSpans: true,
        executionSpans: true,
        hookSpans: true,
        fetchSpans: true,
        flowStageEvents: true,
        transportSpans: true,
        authSpans: true,
        oauthSpans: true,
        elicitationSpans: true,
        startupReport: true,
      });
    });

    it('should resolve logging: true to empty object', () => {
      const plugin = new ObservabilityPlugin({ logging: true });
      expect(plugin.options.logging).toEqual({});
    });

    it('should resolve requestLogs: true to empty object', () => {
      const plugin = new ObservabilityPlugin({ requestLogs: true });
      expect(plugin.options.requestLogs).toEqual({});
    });
  });

  describe('hook methods (tracing enabled)', () => {
    const plugin = new ObservabilityPlugin({ tracing: true });
    const emptyCtx = { state: {} as Record<string | symbol, unknown>, get: () => undefined };

    // HTTP hooks — should not throw with empty context
    it('_httpWillTrace', () => plugin._httpWillTrace(emptyCtx));
    it('_httpWillQuota', () => plugin._httpWillQuota(emptyCtx));
    it('_httpDidSemaphore', () => plugin._httpDidSemaphore(emptyCtx));
    it('_httpWillAuth', () => plugin._httpWillAuth(emptyCtx));
    it('_httpDidAuth', () => plugin._httpDidAuth(emptyCtx));
    it('_httpWillRoute', () => plugin._httpWillRoute(emptyCtx));
    it('_httpDidRoute', () => plugin._httpDidRoute(emptyCtx));
    it('_httpDidFinalize', () => plugin._httpDidFinalize(emptyCtx));

    // Tool hooks
    it('_toolWillParse', () => plugin._toolWillParse(emptyCtx));
    it('_toolWillFind', () => plugin._toolWillFind(emptyCtx));
    it('_toolWillCheckAuth', () => plugin._toolWillCheckAuth(emptyCtx));
    it('_toolWillCreateCtx', () => plugin._toolWillCreateCtx(emptyCtx));
    it('_toolWillValidate', () => plugin._toolWillValidate(emptyCtx));
    it('_toolWillExecute', () => plugin._toolWillExecute(emptyCtx));
    it('_toolDidExecute', () => plugin._toolDidExecute(emptyCtx));
    it('_toolWillValidateOut', () => plugin._toolWillValidateOut(emptyCtx));
    it('_toolWillApplyUI', () => plugin._toolWillApplyUI(emptyCtx));
    it('_toolDidFinalize', () => plugin._toolDidFinalize(emptyCtx));

    // Resource hooks
    it('_resourceWillParse', () => plugin._resourceWillParse(emptyCtx));
    it('_resourceWillFind', () => plugin._resourceWillFind(emptyCtx));
    it('_resourceWillExecute', () => plugin._resourceWillExecute(emptyCtx));
    it('_resourceDidExecute', () => plugin._resourceDidExecute(emptyCtx));
    it('_resourceDidFinalize', () => plugin._resourceDidFinalize(emptyCtx));

    // Prompt hooks
    it('_promptWillParse', () => plugin._promptWillParse(emptyCtx));
    it('_promptWillFind', () => plugin._promptWillFind(emptyCtx));
    it('_promptWillExecute', () => plugin._promptWillExecute(emptyCtx));
    it('_promptDidExecute', () => plugin._promptDidExecute(emptyCtx));
    it('_promptDidFinalize', () => plugin._promptDidFinalize(emptyCtx));

    // Agent hooks
    it('_agentWillParse', () => plugin._agentWillParse(emptyCtx));
    it('_agentWillFind', () => plugin._agentWillFind(emptyCtx));
    it('_agentWillExecute', () => plugin._agentWillExecute(emptyCtx));
    it('_agentDidExecute', () => plugin._agentDidExecute(emptyCtx));
    it('_agentDidFinalize', () => plugin._agentDidFinalize(emptyCtx));

    // List hooks
    it('_listToolsWill', () => plugin._listToolsWill(emptyCtx));
    it('_listToolsDidFind', () => plugin._listToolsDidFind(emptyCtx));
    it('_listToolsDone', () => plugin._listToolsDone(emptyCtx));
    it('_listResourcesWill', () => plugin._listResourcesWill(emptyCtx));
    it('_listResourcesDone', () => plugin._listResourcesDone(emptyCtx));
    it('_listTemplatesWill', () => plugin._listTemplatesWill(emptyCtx));
    it('_listTemplatesDone', () => plugin._listTemplatesDone(emptyCtx));
    it('_listPromptsWill', () => plugin._listPromptsWill(emptyCtx));
    it('_listPromptsDone', () => plugin._listPromptsDone(emptyCtx));

    // Skills hooks
    it('_skillSearchWill', () => plugin._skillSearchWill(emptyCtx));
    it('_skillSearchDone', () => plugin._skillSearchDone(emptyCtx));
    it('_skillLoadWill', () => plugin._skillLoadWill(emptyCtx));
    it('_skillLoadStage', () => plugin._skillLoadStage(emptyCtx));
    it('_skillLoadDone', () => plugin._skillLoadDone(emptyCtx));

    // Completion hooks
    it('_completionWill', () => plugin._completionWill(emptyCtx));
    it('_completionDone', () => plugin._completionDone(emptyCtx));

    // Transport: SSE
    it('_sseWillParse', () => plugin._sseWillParse(emptyCtx));
    it('_sseDidRoute', () => plugin._sseDidRoute(emptyCtx));
    it('_sseDidInit', () => plugin._sseDidInit(emptyCtx));
    it('_sseDidMsg', () => plugin._sseDidMsg(emptyCtx));
    it('_sseDidElicit', () => plugin._sseDidElicit(emptyCtx));
    it('_sseDidCleanup', () => plugin._sseDidCleanup(emptyCtx));

    // Transport: Streamable HTTP
    it('_shttpWillParse', () => plugin._shttpWillParse(emptyCtx));
    it('_shttpDidRoute', () => plugin._shttpDidRoute(emptyCtx));
    it('_shttpDidInit', () => plugin._shttpDidInit(emptyCtx));
    it('_shttpDidMsg', () => plugin._shttpDidMsg(emptyCtx));
    it('_shttpDidElicit', () => plugin._shttpDidElicit(emptyCtx));
    it('_shttpDidSse', () => plugin._shttpDidSse(emptyCtx));
    it('_shttpDidExtApps', () => plugin._shttpDidExtApps(emptyCtx));
    it('_shttpDidCleanup', () => plugin._shttpDidCleanup(emptyCtx));

    // Transport: Stateless HTTP
    it('_slhttpWillParse', () => plugin._slhttpWillParse(emptyCtx));
    it('_slhttpDidHandle', () => plugin._slhttpDidHandle(emptyCtx));
    it('_slhttpDidCleanup', () => plugin._slhttpDidCleanup(emptyCtx));

    // Auth
    it('_authVerifyWill', () => plugin._authVerifyWill(emptyCtx));
    it('_authVerifyDidMode', () => plugin._authVerifyDidMode(emptyCtx));
    it('_authVerifyDidToken', () => plugin._authVerifyDidToken(emptyCtx));
    it('_authVerifyDidBuild', () => plugin._authVerifyDidBuild(emptyCtx));
    it('_sessionVerifyWill', () => plugin._sessionVerifyWill(emptyCtx));
    it('_sessionVerifyDidJwt', () => plugin._sessionVerifyDidJwt(emptyCtx));
    it('_sessionVerifyDidBuild', () => plugin._sessionVerifyDidBuild(emptyCtx));

    // OAuth
    it('_oauthTokenWill', () => plugin._oauthTokenWill(emptyCtx));
    it('_oauthTokenDone', () => plugin._oauthTokenDone(emptyCtx));
    it('_oauthAuthzWill', () => plugin._oauthAuthzWill(emptyCtx));
    it('_oauthAuthzDone', () => plugin._oauthAuthzDone(emptyCtx));
    it('_oauthCallbackWill', () => plugin._oauthCallbackWill(emptyCtx));
    it('_oauthCallbackDone', () => plugin._oauthCallbackDone(emptyCtx));
    it('_oauthProviderWill', () => plugin._oauthProviderWill(emptyCtx));
    it('_oauthProviderDone', () => plugin._oauthProviderDone(emptyCtx));
    it('_oauthRegisterWill', () => plugin._oauthRegisterWill(emptyCtx));
    it('_oauthRegisterDone', () => plugin._oauthRegisterDone(emptyCtx));

    // Elicitation
    it('_elicitReqWill', () => plugin._elicitReqWill(emptyCtx));
    it('_elicitReqDone', () => plugin._elicitReqDone(emptyCtx));
    it('_elicitResWill', () => plugin._elicitResWill(emptyCtx));
    it('_elicitResDone', () => plugin._elicitResDone(emptyCtx));

    // Fetch wrapping
    it('_toolDidCreateCtxFetch', () => plugin._toolDidCreateCtxFetch(emptyCtx));

    // Agent metadata
    it('_agentDidExecuteMeta', () => plugin._agentDidExecuteMeta(emptyCtx));

    // Resource subscriptions
    it('_subscribeWill', () => plugin._subscribeWill(emptyCtx));
    it('_subscribeDone', () => plugin._subscribeDone(emptyCtx));
    it('_unsubscribeWill', () => plugin._unsubscribeWill(emptyCtx));
    it('_unsubscribeDone', () => plugin._unsubscribeDone(emptyCtx));

    // Skills HTTP
    it('_skillsLlmTxtWill', () => plugin._skillsLlmTxtWill(emptyCtx));
    it('_skillsLlmTxtDone', () => plugin._skillsLlmTxtDone(emptyCtx));
    it('_skillsLlmFullTxtWill', () => plugin._skillsLlmFullTxtWill(emptyCtx));
    it('_skillsLlmFullTxtDone', () => plugin._skillsLlmFullTxtDone(emptyCtx));
    it('_skillsApiWill', () => plugin._skillsApiWill(emptyCtx));
    it('_skillsApiDone', () => plugin._skillsApiDone(emptyCtx));

    // Well-known
    it('_jwksWill', () => plugin._jwksWill(emptyCtx));
    it('_jwksDone', () => plugin._jwksDone(emptyCtx));
    it('_oauthServerWill', () => plugin._oauthServerWill(emptyCtx));
    it('_oauthServerDone', () => plugin._oauthServerDone(emptyCtx));
    it('_prmWill', () => plugin._prmWill(emptyCtx));
    it('_prmDone', () => plugin._prmDone(emptyCtx));

    // Logging
    it('_setLevelWill', () => plugin._setLevelWill(emptyCtx));
    it('_setLevelDone', () => plugin._setLevelDone(emptyCtx));

    // Startup report
    it('reportStartupTelemetry', () =>
      plugin.reportStartupTelemetry({
        toolsCount: 5,
        resourcesCount: 2,
        promptsCount: 1,
        pluginsCount: 3,
        durationMs: 100,
      }));
  });

  describe('hook methods (tracing disabled)', () => {
    const plugin = new ObservabilityPlugin({ tracing: false });
    const noop = {};

    it('all hooks are no-ops when tracing is disabled', () => {
      // HTTP
      plugin._httpWillTrace(noop);
      plugin._httpWillQuota(noop);
      plugin._httpDidSemaphore(noop);
      plugin._httpWillAuth(noop);
      plugin._httpDidAuth(noop);
      plugin._httpWillRoute(noop);
      plugin._httpDidRoute(noop);
      plugin._httpDidFinalize(noop);

      // Tool
      plugin._toolWillParse(noop);
      plugin._toolWillFind(noop);
      plugin._toolWillCheckAuth(noop);
      plugin._toolWillCreateCtx(noop);
      plugin._toolWillValidate(noop);
      plugin._toolWillExecute(noop);
      plugin._toolDidExecute(noop);
      plugin._toolWillValidateOut(noop);
      plugin._toolWillApplyUI(noop);
      plugin._toolDidFinalize(noop);

      // Resource
      plugin._resourceWillParse(noop);
      plugin._resourceWillFind(noop);
      plugin._resourceWillExecute(noop);
      plugin._resourceDidExecute(noop);
      plugin._resourceDidFinalize(noop);

      // Prompt
      plugin._promptWillParse(noop);
      plugin._promptWillFind(noop);
      plugin._promptWillExecute(noop);
      plugin._promptDidExecute(noop);
      plugin._promptDidFinalize(noop);

      // Agent
      plugin._agentWillParse(noop);
      plugin._agentWillFind(noop);
      plugin._agentWillExecute(noop);
      plugin._agentDidExecute(noop);
      plugin._agentDidFinalize(noop);

      // Lists
      plugin._listToolsWill(noop);
      plugin._listToolsDidFind(noop);
      plugin._listToolsDone(noop);
      plugin._listResourcesWill(noop);
      plugin._listResourcesDone(noop);
      plugin._listTemplatesWill(noop);
      plugin._listTemplatesDone(noop);
      plugin._listPromptsWill(noop);
      plugin._listPromptsDone(noop);

      // Skills
      plugin._skillSearchWill(noop);
      plugin._skillSearchDone(noop);
      plugin._skillLoadWill(noop);
      plugin._skillLoadStage(noop);
      plugin._skillLoadDone(noop);

      // Completion
      plugin._completionWill(noop);
      plugin._completionDone(noop);

      // Transport: SSE
      plugin._sseWillParse(noop);
      plugin._sseDidRoute(noop);
      plugin._sseDidInit(noop);
      plugin._sseDidMsg(noop);
      plugin._sseDidElicit(noop);
      plugin._sseDidCleanup(noop);

      // Transport: Streamable HTTP
      plugin._shttpWillParse(noop);
      plugin._shttpDidRoute(noop);
      plugin._shttpDidInit(noop);
      plugin._shttpDidMsg(noop);
      plugin._shttpDidElicit(noop);
      plugin._shttpDidSse(noop);
      plugin._shttpDidExtApps(noop);
      plugin._shttpDidCleanup(noop);

      // Transport: Stateless HTTP
      plugin._slhttpWillParse(noop);
      plugin._slhttpDidHandle(noop);
      plugin._slhttpDidCleanup(noop);

      // Auth
      plugin._authVerifyWill(noop);
      plugin._authVerifyDidMode(noop);
      plugin._authVerifyDidToken(noop);
      plugin._authVerifyDidBuild(noop);
      plugin._sessionVerifyWill(noop);
      plugin._sessionVerifyDidJwt(noop);
      plugin._sessionVerifyDidBuild(noop);

      // OAuth
      plugin._oauthTokenWill(noop);
      plugin._oauthTokenDone(noop);
      plugin._oauthAuthzWill(noop);
      plugin._oauthAuthzDone(noop);
      plugin._oauthCallbackWill(noop);
      plugin._oauthCallbackDone(noop);
      plugin._oauthProviderWill(noop);
      plugin._oauthProviderDone(noop);
      plugin._oauthRegisterWill(noop);
      plugin._oauthRegisterDone(noop);

      // Elicitation
      plugin._elicitReqWill(noop);
      plugin._elicitReqDone(noop);
      plugin._elicitResWill(noop);
      plugin._elicitResDone(noop);

      // Fetch & Agent
      plugin._toolDidCreateCtxFetch(noop);
      plugin._agentDidExecuteMeta(noop);

      // Resource subscriptions
      plugin._subscribeWill(noop);
      plugin._subscribeDone(noop);
      plugin._unsubscribeWill(noop);
      plugin._unsubscribeDone(noop);

      // Skills HTTP
      plugin._skillsLlmTxtWill(noop);
      plugin._skillsLlmTxtDone(noop);
      plugin._skillsLlmFullTxtWill(noop);
      plugin._skillsLlmFullTxtDone(noop);
      plugin._skillsApiWill(noop);
      plugin._skillsApiDone(noop);

      // Well-known
      plugin._jwksWill(noop);
      plugin._jwksDone(noop);
      plugin._oauthServerWill(noop);
      plugin._oauthServerDone(noop);
      plugin._prmWill(noop);
      plugin._prmDone(noop);

      // Logging
      plugin._setLevelWill(noop);
      plugin._setLevelDone(noop);

      // Startup
      plugin.reportStartupTelemetry({
        toolsCount: 0,
        resourcesCount: 0,
        promptsCount: 0,
        pluginsCount: 0,
        durationMs: 0,
      });
    });
  });

  describe('dynamicProviders', () => {
    it('should provide tracer and config when tracing is enabled', () => {
      const providers = ObservabilityPlugin.dynamicProviders({ tracing: true });
      const tokens = providers.map((p: any) => p.provide);
      expect(tokens).toContain(OTEL_TRACER);
      expect(tokens).toContain(OTEL_CONFIG);
    });

    it('should not provide tracer when tracing is false', () => {
      const providers = ObservabilityPlugin.dynamicProviders({ tracing: false });
      const tokens = providers.map((p: any) => p.provide);
      expect(tokens).not.toContain(OTEL_TRACER);
    });

    it('should provide StructuredLogTransport when logging is enabled', () => {
      const providers = ObservabilityPlugin.dynamicProviders({ logging: true });
      const tokens = providers.map((p: any) => p.provide);
      expect(tokens).toContain(StructuredLogTransport);
    });

    it('should provide REQUEST_LOG_COLLECTOR when requestLogs is enabled', () => {
      const providers = ObservabilityPlugin.dynamicProviders({ requestLogs: true });
      const tokens = providers.map((p: any) => p.provide);
      expect(tokens).toContain(REQUEST_LOG_COLLECTOR);
    });

    it('should provide nothing when all features are disabled', () => {
      const providers = ObservabilityPlugin.dynamicProviders({
        tracing: false,
        logging: false,
        requestLogs: false,
      });
      expect(providers).toHaveLength(0);
    });
  });
});
