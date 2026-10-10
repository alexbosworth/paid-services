const addServiceLabel = require('./add_service_label');
const decodeRecords = require('./decode_records');
const decodeServiceLabel = require('./decode_service_label');
const decodeServiceRecord = require('./decode_service_record');
const encodeServiceLabel = require('./encode_service_label');
const encodeServiceRecord = require('./encode_service_record');
const getRecordKey = require('./get_record_key');
const hexAsList = require('./hex_as_list');
const listAsHex = require('./list_as_hex');
const numberAsTruncated = require('./number_as_truncated');
const readRecordKeyIndex = require('./read_record_key_index');
const readServiceLabel = require('./read_service_label');
const recordKeyForSecret = require('./record_key_for_secret');
const recordPoint = require('./record_point');
const {serviceTypes} = require('./constants');
const truncatedAsNumber = require('./truncated_as_number');
const withoutRecord = require('./without_record');

module.exports = {
  addServiceLabel,
  decodeRecords,
  decodeServiceLabel,
  decodeServiceRecord,
  encodeServiceLabel,
  encodeServiceRecord,
  getRecordKey,
  hexAsList,
  listAsHex,
  numberAsTruncated,
  readRecordKeyIndex,
  readServiceLabel,
  recordKeyForSecret,
  recordPoint,
  serviceTypes,
  truncatedAsNumber,
  withoutRecord,
};
