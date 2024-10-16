const EventEmitter = require('events');
const {randomBytes} = require('crypto');

const {assembleUnsignedPsbt} = require('ln-sync');

const {decodeFanoutProposal} = require('./../messages');
const {decodeSignedFunding} = require('./../messages');
const {encodeConnectedRecords} = require('./../messages');
const {encodeFanoutDetails} = require('./../messages');
const {encodeSignedRecords} = require('./../messages');
const {encodeUnsignedFunding} = require('./../messages');
const {servicePeerRequests} = require('./../../p2p');
const {serviceTypeConfirmConnected} = require('./../../service_types');
const {serviceTypeGetFanoutDetails} = require('./../../service_types');
const {serviceTypeRegisterPendingFanout} = require('./../../service_types');
const {serviceTypeRegisterSignedFanout} = require('./../../service_types');

const findRecord = (records, type) => records.find(n => n.type === type);
const {isArray} = Array;
const keySpendSignatureHexLength = 128;
const makeGroupId = () => randomBytes(16).toString('hex');
const minGroupCount = 3;
const staleDate = () => new Date(Date.now() - (1000 * 60 * 10)).toISOString();
const typeGroupId = '1';
const uniq = arr => Array.from(new Set(arr));

/** Coordinate fanout

  {
    capacity: <Fanout Output Capacity Tokens Number>
    count: <Group Members Count Number>
    ecp: <ECPair Library Object>
    identity: <Coordinator Identity Public Key Hex String>
    lnd: <Authenticated LND API Object>
    [members]: [<Member Node Id Public Key Hex String>]
    rate: <Chain Fee Rate Number>
  }

  @returns
  {
    events: <Event Emitter Object>
    id: <Group Id Hex String>
    proposed: <Add Proposed Fanout Function>
    sign: <Add Signed Fanout Function>
    signed: <Get Signed PSBTs Function>
    unsigned: <Get Unsigned PSBT Function>
  }

  // All members are connected
  @event 'connected'

  // All members have funded with the coordinator
  @event 'funded'

  // A member has funded with the coordinator
  @event 'funding'
  {
    id: <Funding Member Public Key Hex String>
  }

  // All members are joined
  @event 'joined'
  {
    ids: [<Joined Member Public Key Hex String>]
  }

  // A member signaled they were present
  @event 'present'
  {
    id: <Present Member Public Key Hex String>
  }

  // A member submitted their partial signature
  @event 'signing'
  {
    id: <Member Public Key Hex String>
  }

  // All members have submitted their partial signatures
  @event 'signed'
*/
module.exports = ({capacity, count, ecp, identity, lnd, members, rate}) => {
  if (!capacity) {
    throw new Error('ExpectedOutputSizeCapacityToCoordinateFanoutGroup');
  }

  if (count < minGroupCount) {
    throw new Error('ExpectedHigherGroupMembersCountToCoordinateFanoutGroup');
  }

  if (!ecp) {
    throw new Error('ExpectedEcLibraryToCoordinateFanoutGroup');
  }

  if (!identity) {
    throw new Error('ExpectedSelfIdentityPublicKeyToCoordinateFanoutGroup');
  }

  if (!lnd) {
    throw new Error('ExpectedAuthenticatedLndToCoordinateFanoutGroup');
  }

  if (!!members && uniq(members).length !== count) {
    throw new Error('ExpectedCompleteSetOfAllowedMembersForFanoutGroup');
  }

  if (!rate) {
    throw new Error('ExpectedChainFeeRateToCoordinateFanoutGroup');
  }

  // Instantiate the group with self as a member
  const group = {
    allowed: members,
    emitter: new EventEmitter(),
    members: [{id: identity}],
    proposed: [],
    signed: [],
    unsigned: undefined,
  };

  // The group has an identifier
  const id = makeGroupId();

  // Wait for peer requests
  const service = servicePeerRequests({lnd});

  // Listen for and respond to get fanout group details requests
  service.request({type: serviceTypeGetFanoutDetails}, (req, res) => {
    if (!isArray(req.records)) {
      return res.failure([400, 'ExpectedArrayOfRecordsToGetFanoutDetails']);
    }

    const idRecord = findRecord(req.records, typeGroupId);

    if (!idRecord) {
      return res.failure([400, 'ExpectedGroupIdRecordToGetFanoutDetails']);
    }

    // Exit early when this request is for a different fanout group
    if (idRecord.value !== id) {
      return;
    }

    return res.success(encodeFanoutDetails({capacity, count, rate}));
  });

  // Listen for and respond to confirm connected requests
  service.request({type: serviceTypeConfirmConnected}, (req, res) => {
    if (!isArray(req.records)) {
      return res.failure([400, 'ExpectedArrayOfRecordsForFanoutConnection']);
    }

    const idRecord = findRecord(req.records, typeGroupId);

    if (!idRecord) {
      return res.failure([400, 'ExpectedGroupIdRecordForFanoutConnection']);
    }

    // Exit early when this request is for a different group
    if (idRecord.value !== id) {
      return;
    }

    // Exit early when fanout group member is not allowed
    if (!!group.allowed && !group.allowed.includes(req.from)) {
      return res.failure([403, 'AccessDeniedToFanoutGroup']);
    }

    // Refresh the member list, evicting members who stopped pinging
    group.members = group.members
      .filter(n => !n.last_joined || n.last_joined > staleDate())
      .filter(n => n.id !== req.from);

    // Exit early with failure when the group is full
    if (group.members.length === count) {
      return res.failure([503, 'FanoutGroupIsCurrentlyFull']);
    }

    // Add the group member details to the group
    group.members.push({id: req.from, last_joined: new Date().toISOString()});

    // Notify that the member is present
    group.emitter.emit('present', {id: req.from});

    // Exit with failure when a member dropped out after being locked in
    if (!!group.ids && group.members.length < count) {
      return res.failure([503, 'GroupMemberExited']);
    }

    // Wait for the group to fill
    if (group.members.length < count) {
      return res.success({});
    }

    // Make sure members list is locked in
    group.ids = group.ids || group.members.map(n => n.id);

    // Emit event that everyone has joined
    group.emitter.emit('joined', {ids: group.ids});

    const {records} = encodeConnectedRecords({count: group.members.length});

    // Emit event that all members are connected
    if (group.members.length === count) {
      group.emitter.emit('connected', {});
    }

    return res.success({records});
  });

  // Listen for and respond to fanout proposal registrations
  service.request({type: serviceTypeRegisterPendingFanout}, (req, res) => {
    if (!isArray(req.records)) {
      return res.failure([400, 'ExpectedArrayOfRecordsForPendingFanout']);
    }

    const idRecord = findRecord(req.records, typeGroupId);

    if (!idRecord) {
      return res.failure([400, 'ExpectedGroupIdRecordForPendingFanout']);
    }

    // Exit early when this request is for a different group
    if (idRecord.value !== id) {
      return;
    }

    // Cannot register pending when not part of the locked in group
    if (!group.ids.includes(req.from)) {
      return res.failure([403, 'MembershipNotPresentInLockedInFanoutMembers']);
    }

    try {
      decodeFanoutProposal({records: req.records});
    } catch (err) {
      return res.failure([400, err.message]);
    }

    const proposal = decodeFanoutProposal({records: req.records});

    // Register the pending fanout
    if (!group.proposed.find(n => n.id === req.from)) {
      group.emitter.emit('funding', {id: req.from});

      group.proposed.push({
        change: proposal.change,
        funding: proposal.funding,
        id: req.from,
        utxos: proposal.utxos,
      });
    }

    // Exit early when there are missing proposals
    if (group.proposed.length !== group.ids.length) {
      return res.success({});
    }

    const {failure, success} = res;

    // Exit early when unsigned funding is already assembled
    if (!!group.unsigned) {
      return success(encodeUnsignedFunding({psbt: group.unsigned}));
    }

    // Put together the assembled PSBT
    return assembleUnsignedPsbt({
      capacity,
      rate,
      proposed: group.proposed,
    },
    (err, res) => {
      if (!!err) {
        return failure(err);
      }

      group.unsigned = res.psbt;

      if (group.proposed.length === count) {
        group.emitter.emit('funded', {});
      }

      const {records} = encodeUnsignedFunding({psbt: res.psbt});

      return success({records});
    });
  });

  // Listen for and respond to funding signatures
  service.request({type: serviceTypeRegisterSignedFanout}, (req, res) => {
    if (!isArray(req.records)) {
      return res.failure([400, 'ExpectedArrayOfRecordsForSignedFanout']);
    }

    const idRecord = findRecord(req.records, typeGroupId);

    if (!idRecord) {
      return res.failure([400, 'ExpectedGroupIdRecordToRegisterSignedFanout']);
    }

    // Exit early when this request is for a different fanout group
    if (idRecord.value !== id) {
      return;
    }

    // Cannot register signatures when not part of the locked in group
    if (!group.ids.includes(req.from)) {
      return res.failure([403, 'MembershipNotPresentInLockedInFanoutMembers']);
    }

    try {
      decodeSignedFunding({ecp, records: req.records});
    } catch (err) {
      return res.failure([400, err.message]);
    }

    const signed = decodeSignedFunding({ecp, records: req.records});

    if (signed.p2tr.find(n => n.length !== keySpendSignatureHexLength)) {
      return failure([400, 'InvalidSignatureLengthForKeySpend']);
    }

    // Register the signed funding
    if (!group.signed.find(n => n.id === req.from)) {
      // Emit event to indicate member has submitted their signed PSBT
      group.emitter.emit('signing', {id: req.from});

      group.signed.push({id: req.from, signed: signed.psbt});
    }

    if (group.signed.length === count) {
      group.emitter.emit('signed', {});
    }

    // Let the client know how many signatures are present
    const {records} = encodeSignedRecords({count: group.signed.length});

    return res.success({records});
  });

  return {
    id,
    events: group.emitter,
    proposed: pending => group.proposed.push(pending),
    sign: signed => group.signed.push(signed),
    signed: () => group.signed,
    unsigned: () => group.unsigned,
  };
};
