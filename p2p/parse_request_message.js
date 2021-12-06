const {decodeBigSize} = require('bolt01');
const {decodeTlvStream} = require('bolt01');

const parseResponseCode = require('./parse_response_code');

const defaultRecords = {value: ''};
const findRequestRecords = records => records.find(n => n.type === '5');
const findResponseCodeRecord = records => records.find(n => n.type === '2');
const findRequestIdRecord = records => records.find(n => n.type === '1');
const findTypeRecord = records => records.find(n => n.type === '3');
const findVersionRecord = records => records.find(n => n.type === '0');
const idHexLength = 32 * 2;
const isRequest = message => message.toLowerCase().startsWith('626f73ff');
const requestData = message => message.slice('626f73ff'.length);
const requestType = 32768;
const res = records => records.map(({type, value}) => ({type, value}));

/** Parse a peer request format message

  Messages can either be requests or responses

  {
    message: <Encoded Request Message Hex String>
    type: <Type Number String>
  }

  @throws
  <Error>

  @returns
  {
    [response]: {
      [failure]: [
        <Failure Code Number>
        <Failure Code String>
      ]
      id: <Request Id Hex String>
      records: [{
        type: <Type Number String>
        value: <Value Hex Encoded String>
      }]
    }
    [request]: {
      id: <Request Id Hex String>
      records: [{
        type: <Type Number String>
        value: <Value Hex Encoded String>
      }]
      type: <Type Number String>
    }
  }
*/
module.exports = ({message, type}) => {
  // Exit early when the message type or message content is not request type
  if (type !== requestType || !isRequest(message)) {
    return {};
  }

  const {records} = decodeTlvStream({encoded: requestData(message)});

  const version = findVersionRecord(records);

  if (!!version) {
    throw new Error('UnexpectedVersionNumberOfRequestMessage');
  }

  const idRecord = findRequestIdRecord(records);

  if (!idRecord || idRecord.value.length !== idHexLength) {
    throw new Error('ExpectedRequestIdInRequestMessage');
  }

  const recordsRecord = findRequestRecords(records) || defaultRecords;

  const responseCodeRecord = findResponseCodeRecord(records);
  const typeRecord = findTypeRecord(records);

  // Requests have request types and responses have response codes
  if (!typeRecord && !responseCodeRecord) {
    throw new Error('ExpectedEitherRequestParametersOrResponseCode');
  }

  // Exit early when this is a response to a request
  if (!!responseCodeRecord) {
    const {failure} = parseResponseCode({encoded: responseCodeRecord.value});

    return {
      response: {
        failure,
        id: idRecord.value,
        records: res(decodeTlvStream({encoded: recordsRecord.value}).records),
      },
    };
  }

  return {
    request: {
      id: idRecord.value,
      records: res(decodeTlvStream({encoded: recordsRecord.value}).records),
      type: decodeBigSize({encoded: typeRecord.value}).decoded,
    },
  };
};
