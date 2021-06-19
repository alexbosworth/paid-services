const {encodeTlvStream} = require('bolt01');

const errorAsErrorRecords = require('./error_as_error_records');
const {requestAsRequestRecords} = require('./../records');
const urlsAsUrlsRecord = require('./urls_as_urls_record');

const additionalRecordsType = '1';
const encode = records => encodeTlvStream({records}).encoded;
const encodeError = error => errorAsErrorRecords({error}).encoded;
const encodeNodes = nodes => nodes.join('');
const encodeRequest = request => requestAsRequestRecords({request}).encoded;
const encodeString = string => Buffer.from(string, 'utf8').toString('hex');
const encodeUrls = urls => urlsAsUrlsRecord({urls}).encoded;
const errorType = '0';
const linksType = '4';
const nodesType = '3';
const paywallRecordsType = '2';
const relayRecordsType = '5';
const responseType = '805805';
const standardRecordsType = '0';
const textMessageType = '1';

/** Derive messages for the payment response

  805805:
    [0]: <Error>
      0: <Error Code Number>
      1: <Error Message String>
    [1]: <Text Message String>
    [2]: <Paywall Request Records>
    [3]: <Nodes List>
    [4]: <URLs List>

  {
    [error]: [
      <Error Code Number>
      <Error Message Type String>
    ]
    [links]: [<URL String>]
    [nodes]: [<Node Public Key Id Hex String>]
    [paywall]: <Response Paywall BOLT 11 Payment Request String>
    [records]: [{
      type: <Record Type Number String>
      value: <Record Type Value Hex String>
    }]
    [text]: <Text Response String>
  }

  @throws
  <Error>

  @returns
  {
    messages: [{
      type: <Message Type Number String>
      value: <Message Record Value Hex String>
    }]
  }
*/
module.exports = ({error, links, nodes, paywall, records, text}) => {
  if (!!error && (!!nodes || !!paywall || !!records || !!text)) {
    throw new Error('UnexpectedRecordsForErrorResponse');
  }

  const response = [];
  const standard = [];

  if (!!error) {
    standard.push({type: errorType, value: encodeError(error)});
  }

  if (!!links) {
    standard.push({type: linksType, value: encodeUrls(links)});
  }

  if (!!nodes) {
    standard.push({type: nodesType, value: encodeNodes(nodes)});
  }

  if (!!paywall) {
    standard.push({type: paywallRecordsType, value: encodeRequest(paywall)});
  }

  if (!!records) {
    response.push({type: additionalRecordsType, value: encode(records)});
  }

  if (!!text) {
    standard.push({type: textMessageType, value: encodeString(text)});
  }

  if (!!standard.length) {
    response.push({type: standardRecordsType, value: encode(standard)});
  }

  return {messages: [{type: responseType, value: encode(response)}]};
};
