import 'reflect-metadata';

import { type ReadResourceResult } from '@frontmcp/protocol';

import { ResourceTemplate } from '../../common/decorators/resource.decorator';
import { ResourceContext } from '../../common/interfaces';
import { collectResourceTemplateMetadata, normalizeResourceTemplate } from '../resource.utils';

const reportAuthorities = { roles: { any: ['finance'] } };

@ResourceTemplate({
  name: 'finance-report',
  uriTemplate: 'reports://finance/{reportId}',
  authorities: reportAuthorities,
  featureFlag: 'finance-reports',
} as Parameters<typeof ResourceTemplate>[0])
class FinanceReportTemplate extends ResourceContext<{ reportId: string }> {
  async execute(uri: string): Promise<ReadResourceResult> {
    return { contents: [{ uri, text: 'report' }] };
  }
}

describe('@ResourceTemplate metadata contributed by extensions', () => {
  it('keeps the authorities a template declares', () => {
    expect(collectResourceTemplateMetadata(FinanceReportTemplate)).toMatchObject({ authorities: reportAuthorities });
  });

  it('keeps keys a plugin adds to the template metadata', () => {
    expect(collectResourceTemplateMetadata(FinanceReportTemplate)).toMatchObject({ featureFlag: 'finance-reports' });
  });

  it('carries them onto the normalized record the registry builds entries from', () => {
    expect(normalizeResourceTemplate(FinanceReportTemplate).metadata).toMatchObject({
      name: 'finance-report',
      uriTemplate: 'reports://finance/{reportId}',
      authorities: reportAuthorities,
      featureFlag: 'finance-reports',
    });
  });
});
