const asyncAuto = require('async/auto');
const {returnResult} = require('asyncjs-util');

const argumentsForSchema = require('./arguments_for_schema');
const decodeSchemaRecords = require('./decode_schema_records');
const makeServiceRequest = require('./make_service_request');

const schemaServiceId = '0';

/** Get service schema

  {
    lnd: <Authenticated LND API Object>
    network: <Network Name String>
    named: <Service Name String>
    node: <Node Public Key Hex String>
    [secret]: <Preimage Hex String>
  }

  @returns via cbk or Promise
  {
    description: <Schema Description String>
    [fields]: [{
      [data]: <Data Type String>
      description: <Field Description String>
      limit: <Byte Limit Number>
      type: <Type Number String>
    }]
    id: <Service Id Number String>
  }
*/
module.exports = ({lnd, network, named, node, secret}, cbk) => {
  return new Promise((resolve, reject) => {
    return asyncAuto({
      // Check arguments
      validate: cbk => {
        if (!lnd) {
          return cbk([400, 'ExpectedAuthenticatedLndToGetServiceSchema']);
        }

        if (!named) {
          return cbk([400, 'ExpectedNameOfServiceToGetServiceSchema']);
        }

        if (!network) {
          return cbk([400, 'ExpectedNetworkNameToGetServiceSchema']);
        }

        if (!node) {
          return cbk([400, 'ExpectedNodePublicKeyToGetServiceSchema']);
        }

        return cbk();
      },

      // Get the schema for the named service
      getSchema: ['validate', ({}, cbk) => {
        return makeServiceRequest({
          lnd,
          network,
          node,
          secret,
          arguments: argumentsForSchema({named}).arguments,
          id: schemaServiceId,
        },
        cbk);
      }],

      // Return the schema
      schema: ['getSchema', ({getSchema}, cbk) => {
        if (!getSchema.records) {
          return cbk([503, 'ExpectedSchemaDescriptionRecordsInResponse']);
        }

        // Check that schema records are reasonable
        try {
          decodeSchemaRecords({records: getSchema.records});
        } catch (err) {
          return cbk([503, err.message]);
        }

        const schema = decodeSchemaRecords({records: getSchema.records});

        if (!schema.id) {
          return cbk([503, 'ExpectedServiceIdInSchemaResponse']);
        }

        return cbk(null, {
          description: schema.description,
          fields: schema.fields,
          id: schema.id,
        });
      }],
    },
    returnResult({reject, resolve, of: 'schema'}, cbk));
  });
};
