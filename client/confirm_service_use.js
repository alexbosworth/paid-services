const asyncAuto = require('async/auto');
const asyncMapSeries = require('async/mapSeries');
const {encodeTlvStream} = require('bolt01');
const {parsePaymentRequest} = require('ln-service');
const {returnResult} = require('asyncjs-util');

const byteLimitedString = require('./byte_limited_string');
const {requestAsRequestRecords} = require('./../records');

const byteLength = str => Buffer.byteLength(str, 'utf8');
const encode = records => encodeTlvStream({records}).encoded;
const hexAsBuffer = hex => Buffer.from(hex, 'hex');
const {isArray} = Array;
const isOptional = n => !!(Number(n) % 2);
const {keys} = Object;
const typePaymentRequest = 'request';
const utf8AsHex = utf8 => Buffer.from(utf8, 'utf8').toString('hex');
const utf8AsReqRecords = request => requestAsRequestRecords({request}).encoded;

/** Confirm the use of a service and get any fields

  {
    ask: <Ask Function>
    description: <Service Description String>
    [fields]: [{
      [data]: <Data Type String>
      description: <Field Description String>
      limit: <Byte Limit Number>
      type: <Type Number String>
    }]
  }

  @returns via cbk or Promise
  {
    [arguments]: <TLV Encoded Arguments Hex String>
  }
*/
module.exports = ({ask, description, fields}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!ask) {
          return cbk([400, 'ExpectedInquirerFunctionToConfirmServiceUse']);
        }

        if (!description) {
          return cbk([400, 'ExpectedServiceDescriptionToConfirmServiceUse']);
        }

        if (!!fields && !isArray(fields)) {
          return cbk([400, 'ExpectedArrayOfServiceFieldsForService']);
        }

        return cbk();
      },

      // Describe the service to be used
      confirm: ['validate', ({}, cbk) => {
        return ask([{
          type: 'confirm',
          name: 'proceed',
          message: description,
        }],
        ({proceed}) => {
          if (!proceed) {
            return cbk([400, 'CanceledServiceUse']);
          }

          return cbk();
        });
      }],

      // Get the arguments
      getArguments: ['confirm', ({}, cbk) => {
        // Exit early when there are no arguments for the service
        if (!fields) {
          return cbk();
        }

        const queries =  fields.map(field => {
          switch (field.data) {
          // A payment request should be given
          case typePaymentRequest:
            return {
              message: field.description,
              name: field.type,
              prefix: isOptional(field.type) ? '[Optional]' : undefined,
              validate: input => {
                const request = input.trim();

                // A payment request is required
                if (!request) {
                  return 'A payment request is required.';
                }

                // The payment request must be able to be parsed
                try {
                  parsePaymentRequest({request});
                } catch (err) {
                  return request;
                }

                // The request must be able to be encoded as bytes
                try {
                  requestAsRequestRecords({request});
                } catch (err) {
                  return err.message;
                }

                const {encoded} = requestAsRequestRecords({request});

                if (hexAsBuffer(encoded).length > field.limit) {
                  return 'Payment request too large';
                }

                return true;
              },
            };

          // The default data is a string
          default:
            const {limited} = byteLimitedString({limit: field.limit});

            return {
              filter: input => limited(input).trim(),
              message: field.description,
              name: field.type,
              prefix: isOptional(field.type) ? '[Optional]' : undefined,
              transformer: input => limited(input),
              validate: input => isOptional(field.type) || !!input,
            };
          }
        });

        return ask(queries, answers => cbk(null, answers));
      }],

      // Map service arguments to records
      records: ['getArguments', ({getArguments}, cbk) => {
        // Exit early when there are no fields
        if (!getArguments) {
          return cbk(null, {});
        }

        // Map the user input to encoded arguments
        const arguments = keys(getArguments)
          .map(type => ({type, value: getArguments[type].trim()}))
          .filter(n => !!n.value)
          .map(field => {
            switch (fields.find(n => n.type === field.type).data) {
            // Payment requests are encoded into request records
            case typePaymentRequest:
              return {type: field.type, value: utf8AsReqRecords(field.value)};

            // The default data type is a utf8 string
            default:
              return {type: field.type, value: utf8AsHex(field.value)}
            }
          });

        // Exit early when no arguments were passed
        if (!arguments.length) {
          return cbk(null, {});
        }

        return cbk(null, {arguments: encode(arguments)});
      }],
    },
    returnResult({reject, resolve, of: 'records'}, cbk));
  });
};
