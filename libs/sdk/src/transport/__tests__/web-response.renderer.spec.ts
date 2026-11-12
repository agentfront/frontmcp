/** renderHttpOutputToWebResponse: the Content-Disposition of stream and binary outputs on Fetch-based hosts. */
import type { HttpOutput } from '../../common/schemas/http-output.schema';
import { renderHttpOutputToWebResponse } from '../web-response.renderer';

async function* chunks(): AsyncGenerator<string> {
  yield '<script>1</script>';
}

describe('renderHttpOutputToWebResponse Content-Disposition', () => {
  it('sends a stream marked as an attachment as an attachment, with its filename', () => {
    const output = {
      kind: 'stream',
      status: 200,
      stream: chunks(),
      contentType: 'text/html',
      disposition: 'attachment',
      filename: 'report.html',
    } as HttpOutput;

    const response = renderHttpOutputToWebResponse(output);

    expect(response?.headers.get('content-disposition')).toBe('attachment; filename="report.html"');
  });

  it('quotes a filename with a double quote or backslash so it stays one parameter', () => {
    const output = {
      kind: 'binary',
      status: 200,
      body: new Uint8Array([1]),
      encoding: 'utf8',
      contentType: 'application/octet-stream',
      disposition: 'attachment',
      filename: 'a"; filename*=x\\.bin',
    } as HttpOutput;

    const response = renderHttpOutputToWebResponse(output);

    expect(response?.headers.get('content-disposition')).toBe('attachment; filename="a\\"; filename*=x\\\\.bin"');
  });
});
