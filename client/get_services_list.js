const asyncAuto = require('async/auto');
const {decodeTlvStream} = require('bolt01');
const {returnResult} = require('asyncjs-util');

const makeServiceRequest = require('./make_service_request');

const findListRecord = records => records.find(n => n.type === '0');
const hexAsUtf8 = hex => Buffer.from(hex, 'hex').toString('utf8');
const id = '1';

/** Get available services

  {
    lnd: <Authenticated LND API Object>
    network: <Network Name String>
    named: <Service Name String>
    node: <Node Public Key Hex String>
    [secret]: <Preimage Hex String>
  }

  @returns via cbk or Promise
  {
    services: [{
      id: <Service Id Number String>
      name: <Service Name String>
    }]
  }
*/
module.exports = ({lnd, network, node, secret}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToGetServices']);
        }

        if (!network) {
          return cbk([400, 'ExpectedNetworkNameToGetServices']);
        }

        if (!node) {
          return cbk([400, 'ExpectedNodePublicKeyToGetServiceSchema']);
        }

        return cbk();
      },

      // Get the services on offer
      getServices: ['validate', ({}, cbk) => {
        return makeServiceRequest({id, lnd, network, node, secret}, cbk);
      }],

      // Return the services
      services: ['getServices', ({getServices}, cbk) => {
        if (!getServices.records) {
          return cbk([503, 'ExpectedServicesListRecordsInResponse']);
        }

        const listRecord = findListRecord(getServices.records);

        if (!listRecord) {
          return cbk([503, 'ExpectedServicesListRecordInResponse']);
        }

        try {
          decodeTlvStream({encoded: listRecord.value});
        } catch (err) {
          return cbk([503, 'ExpectedValidListRecordDataInResponse', {err}]);
        }

        const {records} = decodeTlvStream({encoded: listRecord.value});

        const services = records.map(record => {
          return {id: record.type, name: hexAsUtf8(record.value)};
        });

        return cbk(null, {services});
      }],
    },
    returnResult({reject, resolve, of: 'services'}, cbk));
  });
};
