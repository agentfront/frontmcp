import {CacheStoreInterface} from "./cache.types";
import {Token} from "@frontmcp/sdk";

export const CacheStoreToken: Token<CacheStoreInterface> = Symbol('plugin:cache:store');
