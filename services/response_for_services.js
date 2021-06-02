const asyncAuto = require('async/auto');
const {encodeTlvStream} = require('bolt01');
const {returnResult} = require('asyncjs-util');

const registeredServices = require('./registered_services');

const defaultServices = ['0', '1'];
const encode = records => encodeTlvStream({records}).encoded;
const listRecordType = '0';
const utf8AsHex = utf8 => Buffer.from(utf8, 'utf8').toString('hex');

/** Derive a services request from a request if present

  {
    env: <Environment Variables Object>
  }

  @returns
  {
    [response]: {
      records: [{
        type: <Type Number String>
        value: <Value Hex String>
      }]
    }
  }
*/
module.exports = ({env}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!env) {
          return cbk([400, 'ExpectedEnvironmentVarsToGetResponseForServices']);
        }

        return cbk();
      },

      // Derive the list of services
      services: ['validate', ({}, cbk) => {
        const {services} = registeredServices({env});

        const value = encode(services
          .filter(n => !defaultServices.includes(n.id))
          .filter(n => !!n.is_enabled)
          .map(n => ({type: n.id, value: utf8AsHex(n.name)})));

        const records = [{value, type: listRecordType}];

        return cbk(null, {response: {records}});
      }],
    },  
    returnResult({reject, resolve, of: 'services'}, cbk));
  });
};
