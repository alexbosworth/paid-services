const {confirmServiceUse} = require('./client');
const {getServiceSchema} = require('./client');
const {getServicesList} = require('./client');
const {makeServiceRequest} = require('./client');
const {schema} = require('./services');
const {servicePaidRequests} = require('./server');

const serviceIds = schema.types;

module.exports = {
  confirmServiceUse,
  getServiceSchema,
  getServicesList,
  makeServiceRequest,
  serviceIds,
  servicePaidRequests,
};
