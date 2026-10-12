import { resolveTxt } from 'dns/promises';

import { fetchWithTimeout } from './api';
import { parseProofRecord, type ProofRecord } from './keys';

const MAX_PROOF_BYTES = 4096;

export function proofUrl(domain: string): string {
  return `https://${domain}/.well-known/mcp-registry-auth`;
}

/** Fetch the proof as the Registry does and return what is wrong with it, or `undefined` when it is ready. */
export async function checkHttpProof(domain: string, expectedPublicKey: string): Promise<string | undefined> {
  const url = proofUrl(domain);
  const response = await fetchWithTimeout(url, { redirect: 'manual' }, async (answer) => ({
    status: answer.status,
    location: answer.headers.get('location'),
    text: await answer.text(),
  }));
  if (response.status >= 300 && response.status < 400) {
    return (
      `${url} redirects (${response.status}) to ${response.location ?? 'another URL'}. ` +
      'The Registry does not follow redirects: serve the record at this exact URL.'
    );
  }
  if (response.status !== 200) {
    return (
      `${url} answered ${response.status}; the Registry needs 200 with the record. ` +
      `Set MCP_REGISTRY_PUBLIC_KEY=${expectedPublicKey} on the server and redeploy.`
    );
  }
  if (Buffer.byteLength(response.text) > MAX_PROOF_BYTES) {
    return `${url} is larger than ${MAX_PROOF_BYTES} bytes, more than the Registry reads.`;
  }
  return recordProblem(url, parseProofRecord(response.text.trim()), expectedPublicKey);
}

export async function checkDnsProof(domain: string, expectedPublicKey: string): Promise<string | undefined> {
  let records: string[][];
  try {
    records = await resolveTxt(domain);
  } catch (error) {
    return `could not read the TXT records of ${domain} (${(error as NodeJS.ErrnoException).code ?? String(error)}).`;
  }
  const proofs = records.map((chunks) => parseProofRecord(chunks.join(''))).filter((proof) => proof !== undefined);
  if (proofs.some((proof) => proof.algorithm === 'ed25519' && proof.publicKey === expectedPublicKey)) return undefined;
  return recordProblem(`${domain} (DNS TXT)`, proofs[0], expectedPublicKey);
}

function recordProblem(where: string, record: ProofRecord | undefined, expectedPublicKey: string): string | undefined {
  if (!record) return `${where} has no "v=MCPv1; k=ed25519; p=<public key>" record.`;
  if (record.algorithm !== 'ed25519') {
    return `${where} publishes a ${record.algorithm} key, but the private key is Ed25519.`;
  }
  if (record.publicKey !== expectedPublicKey) {
    return (
      `${where} publishes the key ${record.publicKey}, but the private key's public key is ${expectedPublicKey}. ` +
      'Update MCP_REGISTRY_PUBLIC_KEY (or the TXT record), or log in with the matching private key.'
    );
  }
  return undefined;
}
