/**
 * IP-literal parsing and special-purpose range classification, shared by every SSRF guard.
 *
 * An IPv6 address has many spellings of the same destination (`::ffff:169.254.169.254`,
 * `[::ffff:a9fe:a9fe]`, `0:0:0:0:0:ffff:a9fe:a9fe`) and several forms that carry an IPv4 address
 * a translator or tunnel will reach. Guards therefore classify the parsed value, never the text.
 */

export type SpecialPurposeIpRange =
  | 'unspecified'
  | 'this-network'
  | 'loopback'
  | 'private'
  | 'carrier-grade-nat'
  | 'link-local'
  | 'cloud-metadata'
  | 'ietf-protocol'
  | 'benchmarking'
  | 'site-local'
  | 'multicast'
  | 'local-use-nat64'
  | 'reserved';

export type IpAddressRange = 'public' | SpecialPurposeIpRange;

/**
 * `cidr` is the special-purpose block that matched (e.g. `172.16.0.0/12`); `embeddedIpv4` is the
 * IPv4 address an IPv6 address carries (mapped, translated, compatible, NAT64 or 6to4).
 */
export type IpAddressClassification = { family: 4 | 6; embeddedIpv4?: string } & (
  | { range: 'public' }
  | { range: SpecialPurposeIpRange; cidr: string }
);

interface AddressBlock<Value> {
  cidr: string;
  network: number[];
  prefixLength: number;
  value: Value;
}

const IPV4_OCTET_PATTERN = /^(0|[1-9]\d{0,2})$/;
const IPV6_GROUP_PATTERN = /^[0-9a-f]{1,4}$/;

const IPV4_BLOCKS = compileBlocks<SpecialPurposeIpRange>(
  [
    ['0.0.0.0/8', 'this-network'],
    ['10.0.0.0/8', 'private'],
    ['100.64.0.0/10', 'carrier-grade-nat'],
    ['127.0.0.0/8', 'loopback'],
    ['169.254.0.0/16', 'link-local'],
    ['172.16.0.0/12', 'private'],
    ['192.0.0.0/24', 'ietf-protocol'],
    ['192.168.0.0/16', 'private'],
    ['198.18.0.0/15', 'benchmarking'],
    ['224.0.0.0/4', 'multicast'],
    ['255.255.255.255/32', 'reserved'],
    ['240.0.0.0/4', 'reserved'],
  ],
  parseIpv4,
);

const IPV6_BLOCKS = compileBlocks<SpecialPurposeIpRange>(
  [
    ['::/128', 'unspecified'],
    ['::1/128', 'loopback'],
    ['fd00:ec2::254/128', 'cloud-metadata'],
    ['fc00::/7', 'private'],
    ['fe80::/10', 'link-local'],
    ['fec0::/10', 'site-local'],
    // RFC 8215 local-use NAT64: where the IPv4 address sits depends on the operator's prefix length.
    ['64:ff9b:1::/48', 'local-use-nat64'],
    ['ff00::/8', 'multicast'],
  ],
  expandIpv6,
);

// Value: index of the first of the two groups that hold the IPv4 address.
const IPV4_EMBEDDINGS = compileBlocks<number>(
  [
    ['::ffff:0:0/96', 6],
    ['::ffff:0:0:0/96', 6],
    ['::/96', 6],
    ['64:ff9b::/96', 6],
    ['2002::/16', 1],
  ],
  expandIpv6,
);

/** Parse a strict dotted-quad IPv4 address; leading zeros are refused because some stacks read them as octal. */
export function parseIpv4(address: string): number[] | undefined {
  const parts = address.split('.');
  if (parts.length !== 4 || !parts.every((part) => IPV4_OCTET_PATTERN.test(part))) return undefined;
  const octets = parts.map(Number);
  return octets.every((octet) => octet <= 255) ? octets : undefined;
}

/** Expand an IPv6 address (zone id stripped, trailing dotted quad allowed) to its eight 16-bit groups. */
export function expandIpv6(address: string): number[] | undefined {
  const zoneIndex = address.indexOf('%');
  let text = (zoneIndex === -1 ? address : address.slice(0, zoneIndex)).toLowerCase();

  const lastColonIndex = text.lastIndexOf(':');
  const trailingSegment = text.slice(lastColonIndex + 1);
  if (lastColonIndex !== -1 && trailingSegment.includes('.')) {
    const octets = parseIpv4(trailingSegment);
    if (!octets) return undefined;
    const highGroup = ((octets[0] << 8) | octets[1]).toString(16);
    const lowGroup = ((octets[2] << 8) | octets[3]).toString(16);
    text = `${text.slice(0, lastColonIndex + 1)}${highGroup}:${lowGroup}`;
  }

  const halves = text.split('::');
  if (halves.length > 2) return undefined;

  const head = parseIpv6Groups(halves[0]);
  if (!head) return undefined;
  if (halves.length === 1) return head.length === 8 ? head : undefined;

  const tail = parseIpv6Groups(halves[1]);
  if (!tail || head.length + tail.length > 7) return undefined;
  return [...head, ...new Array<number>(8 - head.length - tail.length).fill(0), ...tail];
}

/** The IPv4 address carried by an expanded IPv6 address, where it carries one. */
export function extractEmbeddedIpv4(groups: readonly number[]): string | undefined {
  const octets = findEmbeddedIpv4Octets(groups);
  return octets ? octets.join('.') : undefined;
}

/**
 * Classify an IPv4 or IPv6 literal (IPv6 optionally in URL brackets) by the special-purpose block
 * it falls in. An IPv6 address that carries an IPv4 address is judged by that IPv4 address.
 *
 * @returns undefined when the input is not a well-formed IP literal.
 */
export function classifyIpAddress(address: string): IpAddressClassification | undefined {
  const isBracketed = address.startsWith('[') && address.endsWith(']');
  const octets = isBracketed ? undefined : parseIpv4(address);
  if (octets) return classifyIpv4(octets);

  const groups = expandIpv6(isBracketed ? address.slice(1, -1) : address);
  if (!groups) return undefined;

  const block = IPV6_BLOCKS.find((candidate) => matchesBlock(groups, candidate, 16));
  if (block) return { family: 6, range: block.value, cidr: block.cidr };

  const embeddedOctets = findEmbeddedIpv4Octets(groups);
  if (!embeddedOctets) return { family: 6, range: 'public' };
  return { ...classifyIpv4(embeddedOctets), family: 6, embeddedIpv4: embeddedOctets.join('.') };
}

function classifyIpv4(octets: readonly number[]): IpAddressClassification {
  const block = IPV4_BLOCKS.find((candidate) => matchesBlock(octets, candidate, 8));
  return block ? { family: 4, range: block.value, cidr: block.cidr } : { family: 4, range: 'public' };
}

function findEmbeddedIpv4Octets(groups: readonly number[]): number[] | undefined {
  const embedding = IPV4_EMBEDDINGS.find((block) => matchesBlock(groups, block, 16));
  if (!embedding) return undefined;
  const highGroup = groups[embedding.value];
  const lowGroup = groups[embedding.value + 1];
  return [highGroup >> 8, highGroup & 0xff, lowGroup >> 8, lowGroup & 0xff];
}

function parseIpv6Groups(part: string): number[] | undefined {
  if (part === '') return [];
  const groups = part.split(':');
  if (!groups.every((group) => IPV6_GROUP_PATTERN.test(group))) return undefined;
  return groups.map((group) => parseInt(group, 16));
}

function matchesBlock<Value>(words: readonly number[], block: AddressBlock<Value>, bitsPerWord: number): boolean {
  let remainingBits = block.prefixLength;
  for (let index = 0; remainingBits > 0; index++) {
    const comparedBits = Math.min(bitsPerWord, remainingBits);
    const ignoredBits = bitsPerWord - comparedBits;
    if (words[index] >> ignoredBits !== block.network[index] >> ignoredBits) return false;
    remainingBits -= comparedBits;
  }
  return true;
}

function compileBlocks<Value>(
  entries: ReadonlyArray<readonly [cidr: string, value: Value]>,
  parseNetwork: (text: string) => number[] | undefined,
): AddressBlock<Value>[] {
  return entries.map(([cidr, value]) => {
    const [networkText, prefixText] = cidr.split('/');
    const network = parseNetwork(networkText);
    if (!network) throw new Error(`Invalid network in address block "${cidr}"`);
    return { cidr, network, prefixLength: Number(prefixText), value };
  });
}
