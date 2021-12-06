const {confirmServiceUse} = require('./client');
const {getServiceSchema} = require('./client');
const {getServicesList} = require('./client');
const {makePeerRequest} = require('./p2p');
const {makeServiceRequest} = require('./client');
const {manageTrades} = require('./trades');
const {schema} = require('./services');
const {servicePaidRequests} = require('./server');
const {servicePeerRequests} = require('./p2p');

const serviceIds = schema.types;

module.exports = {
  confirmServiceUse,
  getServiceSchema,
  getServicesList,
  makePeerRequest,
  makeServiceRequest,
  manageTrades,
  serviceIds,
  servicePaidRequests,
  servicePeerRequests,
};
