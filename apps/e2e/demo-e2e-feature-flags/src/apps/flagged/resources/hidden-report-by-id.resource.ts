import { ResourceContext, ResourceTemplate, type ReadResourceResult } from '@frontmcp/sdk';

@ResourceTemplate({
  name: 'hidden-report-by-id',
  uriTemplate: 'flags://hidden-report/{reportId}',
  description: 'Resource template gated behind a feature flag (disabled)',
  mimeType: 'application/json',
  featureFlag: 'flag-for-hidden-resource',
})
export default class HiddenReportByIdResource extends ResourceContext<{ reportId: string }> {
  async execute(uri: string, params: { reportId: string }): Promise<ReadResourceResult> {
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({ status: 'leaked', reportId: params.reportId }),
        },
      ],
    };
  }
}
