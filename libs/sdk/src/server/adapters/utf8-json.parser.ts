import express from 'express';

import { isUtf8Json } from './host-adapter.shared';
import { utf8JsonParserWith } from './utf8-json.body';

export { keepBodyBytes } from './utf8-json.body';

// body-parser's `json()` for UTF-8 bodies, read by its `raw()` but decoded without iconv-lite, which loads all its encodings.
export function utf8JsonParser(limit: number | string): express.RequestHandler {
  return utf8JsonParserWith(express.raw({ limit, type: isUtf8Json })) as express.RequestHandler;
}
