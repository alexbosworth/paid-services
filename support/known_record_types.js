const constants = require('./constants');

/** Known record types of the TLV streams that are decoded

  Records of other even types cannot be ignored.

  {
    knownEntryTypes: [<Menu Entry Record Type Number String>]
    knownMenuTypes: [<Support Menu Record Type Number String>]
    knownRecordTypes: [<Support Service Record Data Type Number String>]
  }
*/
module.exports = {
  knownEntryTypes: [
    constants.typeEntryIssuerId,
    constants.typeEntryName,
    constants.typeEntryOffer,
    constants.typeEntryOfferWithoutPaths,
    constants.typeEntryServiceId,
    constants.typeEntryServiceSequence,
  ],
  knownMenuTypes: [
    constants.typeMenuEntries,
    constants.typeMenuExpiry,
    constants.typeMenuId,
    constants.typeMenuPage,
    constants.typeMenuPages,
    constants.typeMenuSignature,
  ],
  knownRecordTypes: [
    constants.typeRecordKeyIndex,
    constants.typeRecordMaxRequests,
    constants.typeRecordMaxUnpaid,
    constants.typeRecordOffer,
    constants.typeRecordPathIds,
  ],
};
