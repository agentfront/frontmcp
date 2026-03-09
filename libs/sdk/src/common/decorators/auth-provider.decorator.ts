import 'reflect-metadata';
import { FrontMcpAuthProviderTokens } from '../tokens';
import { AuthProviderMetadata, frontMcpAuthProviderMetadataSchema } from '../metadata';

/**
 * Decorator that marks a class as an AuthProvider module and provides metadata
 */
function FrontMcpAuthProvider(providedMetadata: AuthProviderMetadata): ClassDecorator {
  return (target: Function) => {
    const metadata = frontMcpAuthProviderMetadataSchema.parse(providedMetadata);

    Reflect.defineMetadata(FrontMcpAuthProviderTokens.type, true, target);

    for (const property in metadata) {
      Reflect.defineMetadata(FrontMcpAuthProviderTokens[property] ?? property, metadata[property], target);
    }
  };
}

export { FrontMcpAuthProvider, FrontMcpAuthProvider as AuthProvider };
