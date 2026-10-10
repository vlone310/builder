import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Webhook URLs come from tenants, so the worker refuses to call private,
 * loopback or link-local addresses (cloud metadata endpoints included) unless
 * explicitly allowed for local development.
 */

function ipv4ToNumber(ip: string): number {
  return ip.split(".").reduce((n, part) => n * 256 + Number(part), 0);
}

const PRIVATE_V4: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const value = ipv4ToNumber(ip);
    return PRIVATE_V4.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return (value & mask) >>> 0 === (ipv4ToNumber(base) & mask) >>> 0;
    });
  }
  const v6 = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (v6 === "::" || v6 === "::1") return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapped?.[1]) return isPrivateAddress(mapped[1]);
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v6);
}

export class BlockedAddressError extends Error {
  constructor(host: string, address: string) {
    super(`Refusing to call ${host}: it resolves to a private address (${address})`);
    this.name = "BlockedAddressError";
  }
}

/** Throws unless every address the host resolves to is public. */
export async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host)
    ? [{ address: host }]
    : await lookup(host, { all: true, verbatim: true });
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) throw new BlockedAddressError(hostname, address);
  }
}
