import { BlockList, isIP } from 'node:net';

const blocked4 = new BlockList();
for (const [address, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['168.63.129.16', 32],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked4.addSubnet(address, bits, 'ipv4');
const global6 = new BlockList();
global6.addSubnet('2000::', 3, 'ipv6');
const blocked6 = new BlockList();
for (const [address, bits] of [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
] as const)
  blocked6.addSubnet(address, bits, 'ipv6');
const privateRoutes = new BlockList();
for (const [address, bits] of [
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
] as const)
  privateRoutes.addSubnet(address, bits, 'ipv4');
const ula = new BlockList();
ula.addSubnet('fc00::', 7, 'ipv6');
const metadata6 = new BlockList();
metadata6.addSubnet('fd00:ec2::', 32, 'ipv6');
metadata6.addSubnet('fd20:ce::', 32, 'ipv6');

export function isPublicOutboundAddress(address: string): boolean {
  return isIP(address) === 4
    ? !blocked4.check(address, 'ipv4')
    : isIP(address) === 6 &&
        global6.check(address, 'ipv6') &&
        !blocked6.check(address, 'ipv6');
}
export function isPrivateRouteAddress(address: string): boolean {
  const family = isIP(address);
  // Never allow mapped IPv4, loopback, link-local/metadata, CGNAT or transitions.
  return family === 4
    ? privateRoutes.check(address, 'ipv4')
    : family === 6 &&
        ula.check(address, 'ipv6') &&
        !metadata6.check(address, 'ipv6');
}
export function sameAddress(expected: string, actual: string): boolean {
  const addresses = new BlockList();
  const family = isIP(expected);
  if (!family || !isIP(actual)) return false;
  addresses.addAddress(expected, family === 4 ? 'ipv4' : 'ipv6');
  return addresses.check(actual, isIP(actual) === 4 ? 'ipv4' : 'ipv6');
}
