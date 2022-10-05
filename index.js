const {balancedOpenRequest} = require('./balanced');
const {changeChannelCapacity} = require('./capacity');
const {confirmServiceUse} = require('./client');
const {createAnchoredTrade} = require('./trades');
const {createGroupChannel} = require('./groups');
const {decodeTrade} = require('./trades');
const {encodeTrade} = require('./trades');
const {getAnchoredTrade} = require('./trades');
const {getServiceSchema} = require('./client');
const {getServicesList} = require('./client');
const {joinGroupChannel} = require('./groups');
const {makePeerRequest} = require('./p2p');
const {makeServiceRequest} = require('./client');
const {manageGroupJoin} = require('./groups');
const {manageSwap} = require('./swaps');
const {manageTrades} = require('./trades');
const {schema} = require('./services');
const {serviceAnchoredTrades} = require('./trades');
const {servicePaidRequests} = require('./server');
const {servicePeerRequests} = require('./p2p');

const serviceIds = schema.types;

module.exports = {
  balancedOpenRequest,
  changeChannelCapacity,
  confirmServiceUse,
  createAnchoredTrade,
  createGroupChannel,
  decodeTrade,
  encodeTrade,
  getAnchoredTrade,
  getServiceSchema,
  getServicesList,
  joinGroupChannel,
  makePeerRequest,
  makeServiceRequest,
  manageGroupJoin,
  manageSwap,
  manageTrades,
  serviceAnchoredTrades,
  serviceIds,
  servicePaidRequests,
  servicePeerRequests,
};
