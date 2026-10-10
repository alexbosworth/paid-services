const {typeKeyIndex} = require('./constants');
const {typeSalt} = require('./constants');
const {typeSealedData} = require('./constants');
const {typeServiceId} = require('./constants');
const {typeServiceSequence} = require('./constants');
const {typeServiceType} = require('./constants');
const {typeVersion} = require('./constants');

/** Record types that are known in service labels and in service records

  Unknown even records cannot be ignored when decoding

  {
    label: [<Known Service Label Record Type Number String>]
    record: [<Known Service Record Record Type Number String>]
  }
*/
module.exports = {
  label: [typeServiceId, typeServiceSequence, typeServiceType, typeVersion],
  record: [
    typeKeyIndex,
    typeSalt,
    typeSealedData,
    typeServiceType,
    typeVersion,
  ],
};
