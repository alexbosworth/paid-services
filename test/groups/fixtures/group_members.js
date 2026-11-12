// Make a dummy node public key
const publicKey = (prefix, byte) => `${prefix}${byte.repeat(32)}`;

module.exports = {
  identity: publicKey('02', '11'),
  member: publicKey('02', '22'),
  other: publicKey('02', '33'),
  outsider: publicKey('03', '44'),
};
