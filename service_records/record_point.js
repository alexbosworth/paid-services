const {createHash} = require('node:crypto');

const {isPoint} = require('tiny-secp256k1');

const {recordPointTag} = require('./constants');

const bufferAsHex = buffer => buffer.toString('hex');
const evenPrefix = Buffer.from('02', 'hex');
const firstPoint = n => isPoint(pointOf(n)) ? pointOf(n) : firstPoint(n + 1);
const pointOf = n => Buffer.concat([evenPrefix, sha256(recordPointTag + n)]);
const sha256 = n => createHash('sha256').update(n).digest();

/** Get the point that the service record key is derived with

  The point is found by hashing a tag with a counter until the hash is the x
  coordinate of a point, so nobody knows its private key. The shared secret of
  a key of the node and this point is only known to the node.

  @returns
  {
    public_key: <Record Point Public Key Hex String>
  }
*/
module.exports = () => ({public_key: bufferAsHex(firstPoint(Number()))});
