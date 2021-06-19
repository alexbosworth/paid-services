const asyncAuto = require('async/auto');
const {decodeBigSize} = require('bolt01');
const {decodeTlvStream} = require('bolt01');
const {encodeBigSize} = require('bolt01');
const {encodeTlvStream} = require('bolt01');
const {returnResult} = require('asyncjs-util');

const {dataTypes} = require('./schema');
const registeredServices = require('./registered_services');
const {types} = require('./schema');

const asBigSize = number => encodeBigSize({number}).encoded;
const encodeNumber = number => encodeBigSize({number}).encoded;
const fieldDataType = '2';
const fieldDescriptionType = '0';
const fieldExpectByteLimit = '1';
const findId = records => records.find(n => n.type === '0');
const findNamed = records => records.find(n => n.type === '1');
const findService = records => records.find(n => n.type === '0');
const hexAsString = hex => Buffer.from(hex, 'hex').toString('utf8');
const recordForDesc = n => ({type: '2', value: n.toString('hex')});
const recordForFields = fields => ({type: '3', value: fields.encoded});
const recordForType = serviceId => ({type: '1', value: serviceId});
const stringAsBuffer = string => Buffer.from(string, 'utf8');
const utf8AsHex = utf8 => Buffer.from(utf8, 'utf8').toString('hex');

/** Derive a schema request from a request if present

  {
    arguments: <Arguments TLV Hex String>
    env: <Environment Variables Object>
  }

  @returns
  {
    [response]: {
      records: [{
        type: <Record Type Number String>
        value: <Record Type Value Hex String>
      }]
    }
  }
*/
module.exports = ({env, arguments}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!env) {
          return cbk([500, 'ServerConfigurationMissingForSchemaRequest']);
        }

        try {
          decodeTlvStream({encoded: arguments});
        } catch (err) {
          return cbk([400, 'ExpectedTlvStreamArgumentsForInboxService']);;
        }

        return cbk();
      },

      // Decode the arguments for the inbox request
      decodeArguments: ['validate', ({}, cbk) => {
        const {records} = decodeTlvStream({encoded: arguments});

        const service = findService(records);

        if (!service || !service.value) {
          return cbk([400, 'ExpectedPaidServiceToReturnSchemaFor']);
        }

        // The service value should itself be a TLV stream
        try {
          return cbk(null, decodeTlvStream({encoded: service.value}).records);
        } catch (err) {
          return cbk([400, 'ExpectedServiceIdentificationTlvStream']);
        }
      }],

      // Derive the registered services
      services: ['validate', ({}, cbk) => {
        return cbk(null, registeredServices({env}).services);
      }],

      // Derive the service id from the arguments
      serviceId: ['decodeArguments', ({decodeArguments}, cbk) => {
        const id = findId(decodeArguments);

        if (!!id) {
          try {
            decodeBigSize({encoded: id.value});
          } catch (err) {
            return cbk([400, 'ExpectedValidBigSizeEncodedServiceIdValue']);
          }
        }

        // Exit early when the id is specified
        if (!!id) {
          return cbk(null, {id: decodeBigSize({encoded: id.value}).decoded});
        }

        const named = findNamed(decodeArguments);

        if (!named) {
          return cbk([400, 'ExpectedNamedServiceIdForSchemaRequest']);
        }

        if (!types[hexAsString(named.value)]) {
          return cbk([404, 'UnrecognizedPaidServiceName']);
        }

        const type = types[hexAsString(named.value)];

        // A service id record is included when the service name was used
        return cbk(null, {id: type, type: recordForType(encodeNumber(type))});
      }],

      // Response to return
      response: ['serviceId', 'services', ({serviceId, services}, cbk) => {
        const service = services.find(n => n.id === serviceId.id);

        // An unknown service has no details
        if (!service) {
          return cbk([404, 'UnrecognizedPaidServiceId']);
        }

        // Not all services are enabled by default
        if (!service.is_enabled) {
          return cbk([404, 'RequestedServiceNotCurrentlyEnabled']);
        }

        // A record in the response describes the service
        const descRecord = recordForDesc(stringAsBuffer(service.description));

        // A service can have request fields
        const fields = (service.fields || []).map(field => {
          // The description record describes what the field is for as a string
          const description = {
            type: fieldDescriptionType,
            value: utf8AsHex(field.description),
          };

          // The byte limit maximum for the field
          const limit = {
            type: fieldExpectByteLimit,
            value: !field.limit ? null : asBigSize(field.limit.toString()),
          }

          // The data type for the field
          const data = {
            type: fieldDataType,
            value: !!field.data ? asBigSize(dataTypes[field.data]) : undefined,
          };

          // Fields are described in a TLV stream
          const records = [data, description, limit].filter(n => !!n.value);

          return {type: field.type, value: encodeTlvStream({records}).encoded};
        });

        // Every service has a decription and can return a service id number
        const basic = [].concat(serviceId.type).concat(descRecord);

        // Exit early when there are no service arguments
        if (!fields.length) {
          return cbk(null, {response: {records: basic.filter(n => !!n)}});
        }

        const fieldNames = recordForFields(encodeTlvStream({records: fields}));

        const records = [].concat(basic.filter(n => !!n)).concat(fieldNames);

        return cbk(null, {response: {records}});
      }],
    },
    returnResult({reject, resolve, of: 'response'}, cbk));
  });
};
