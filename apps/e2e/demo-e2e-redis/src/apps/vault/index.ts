import { App } from '@frontmcp/sdk';

import AddCredentialTool from './tools/add-credential.tool';
import AuthorizeAppTool from './tools/authorize-app.tool';
import CompletePendingAuthTool from './tools/complete-pending-auth.tool';
import CreatePendingAuthTool from './tools/create-pending-auth.tool';
import CreateVaultEntryTool from './tools/create-vault-entry.tool';
import DeleteVaultEntryTool from './tools/delete-vault-entry.tool';
import GetCredentialsTool from './tools/get-credentials.tool';
import GetVaultEntryTool from './tools/get-vault-entry.tool';
import UpdateConsentTool from './tools/update-consent.tool';
import UpdateVaultEntryTool from './tools/update-vault-entry.tool';

@App({
  name: 'Vault',
  description: 'Storage Authorization Vault testing app for E2E tests',
  tools: [
    CreateVaultEntryTool,
    GetVaultEntryTool,
    UpdateVaultEntryTool,
    DeleteVaultEntryTool,
    AddCredentialTool,
    GetCredentialsTool,
    CreatePendingAuthTool,
    CompletePendingAuthTool,
    AuthorizeAppTool,
    UpdateConsentTool,
  ],
})
export class VaultApp {}
