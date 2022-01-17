const {changeChannelCapacity} = require('./capacity');
const {confirmServiceUse} = require('./client');
const {encodeTrade} = require('./trades');
const {getServiceSchema} = require('./client');
const {getServicesList} = require('./client');
const {makePeerRequest} = require('./p2p');
const {makeServiceRequest} = require('./client');
const {manageTrades} = require('./trades');
const {schema} = require('./services');
const {serviceAnchoredTrades} = require('./trades');
const {servicePaidRequests} = require('./server');
const {servicePeerRequests} = require('./p2p');

const serviceIds = schema.types;

module.exports = {
  changeChannelCapacity,
  confirmServiceUse,
  encodeTrade,
  getServiceSchema,
  getServicesList,
  makePeerRequest,
  makeServiceRequest,
  manageTrades,
  serviceAnchoredTrades,
  serviceIds,
  servicePaidRequests,
  servicePeerRequests,
};
