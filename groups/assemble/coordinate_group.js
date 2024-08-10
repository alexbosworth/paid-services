const EventEmitter = require('events');
const {randomBytes} = require('crypto');

const assembleUnsignedPsbt = require('./assemble_unsigned_psbt');
const {decodePendingProposal} = require('./../messages');
const {decodeSignedFunding} = require('./../messages');
const {encodeConnectedRecords} = require('./../messages');
const {encodeGroupDetails} = require('./../messages');
const {encodeSignedRecords} = require('./../messages');
const {encodeUnsignedFunding} = require('./../messages');
const {encodePartnersRecords} = require('./../messages');
const {partnersFromMembers} = require('./../members');
const {servicePeerRequests} = require('./../../p2p');
const {serviceTypeConfirmConnected} = require('./../../service_types');
const {serviceTypeFindGroupPartners} = require('./../../service_types');
const {serviceTypeGetGroupDetails} = require('./../../service_types');
const {serviceTypeRegisterPendingOpen} = require('./../../service_types');
const {serviceTypeRegisterSignedOpen} = require('./../../service_types');

const findRecord = (records, type) => records.find(n => n.type === type);
const {isArray} = Array;
const makeGroupId = () => randomBytes(16).toString('hex');
const minGroupCount = 2;
const now = () => new Date().toISOString();
const staleDate = () => new Date(Date.now() - (1000 * 60 * 10)).toISOString();
const typeGroupId = '1';
const uniq = arr => Array.from(new Set(arr));

/** Coordinate channel group

  {
    capacity: <Channel Capacity Tokens Number>
    count: <Group Members Count Number>
    identity: <Coordinator Identity Public Key Hex String>
    lnd: <Authenticated LND API Object>
    [members]: [<Member Node Id Public Key Hex String>]
    rate: <Chain Fee Rate Number>
    [skipchannels]: <Skip Channels Creation Bool>
  }

  @returns
  {
    events: <Event Emitter Object>
    id: <Group Id Hex String>
    connected: <Add Connected Identity Public Key Hex String>
    partners: <Get Channel Partners Function>
    proposed: <Add Proposed Channel Function>
    sign: <Add Signed Channel Function>
    signed: <Get Signed PSBTs Function>
    unsigned: <Get Unsigned PSBT Function>
  }

  // All members are connected
  @event 'connected'

  // A member was connected to their peers
  @event 'connecting'
  {
    id: <Connected Member Public Key Hex String>
  }

  // All members have funded with their outbound peers
  @event 'funded'

  // A member has funded with their outbound peer
  @event 'funding'
  {
    id: <Funding Member Public Key Hex String>
  }

  // A new member joined
  @event 'joining'
  {
    id: <Joined Member Public Key Hex String>
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
module.exports = ({capacity, count, identity, lnd, members, rate, skipchannels}) => {
  if (count < minGroupCount) {
    throw new Error('ExpectedHigherGroupMembersCountToCoordinateGroup');
  }

  if (!identity) {
    throw new Error('ExpectedSelfIdentityPublicKeyToCoordinateGroup');
  }

  if (!lnd) {
    throw new Error('ExpectedAuthenticatedLndToCoordinateGroup');
  }

  if (!!members && uniq(members).length !== count) {
    throw new Error('ExpectedCompleteSetOfAllowedMembers');
  }

  // Instantiate the group with self as a member
  const group = {
    allowed: members,
    connected: [],
    emitter: new EventEmitter(),
    members: [{id: identity}],
    proposed: [],
    signed: [],
  };

  // The group has an identifier
  const id = makeGroupId();

  // Wait for peer requests
  const service = servicePeerRequests({lnd});

  // Listen for and respond to get group details requests
  service.request({type: serviceTypeGetGroupDetails}, (req, res) => {
    if (!isArray(req.records)) {
      return res.failure([400, 'ExpectedArrayOfRecordsToGetGroupDetails']);
    }

    const idRecord = findRecord(req.records, typeGroupId);

    if (!idRecord) {
      return res.failure([400, 'ExpectedGroupIdRecordToGetGroupDetails']);
    }

    // Exit early when this request is for a different group
    if (idRecord.value !== id) {
      return;
    }

    return res.success(encodeGroupDetails({capacity, count, rate, skipchannels}));
  });

  // Listen for and respond to find member requests
  service.request({type: serviceTypeFindGroupPartners}, (req, res) => {
    if (!isArray(req.records)) {
      return res.failure([400, 'ExpectedArrayOfRecordsToFindGroupPartners']);
    }

    const idRecord = findRecord(req.records, typeGroupId);

    if (!idRecord) {
      return res.failure([400, 'ExpectedGroupIdRecordToFindGroupPartners']);
    }

    // Exit early when this request is for a different group
    if (idRecord.value !== id) {
      return;
    }

    // Exit early when group member is not allowed
    if (!!group.allowed && !group.allowed.includes(req.from)) {
      return res.failure([403, 'AccessDeniedToGroup']);
    }

    // Emit event that someone is joining
    if (!group.members.find(n => n.id === req.from)) {
      group.emitter.emit('joining', {id: req.from});
    }

    // Refresh the member list, evicting members who stopped pinging
    group.members = group.members
      .filter(n => !n.last_joined || n.last_joined > staleDate())
      .filter(n => n.id !== req.from);

    // Exit early with failure when the group is full
    if (group.members.length === count) {
      return res.failure([503, 'GroupIsCurrentlyFull']);
    }

    // Add the group member details to the group
    group.members.push({id: req.from, last_joined: new Date().toISOString()});

    // Notify that the member is present
    group.emitter.emit('present', {id: req.from});

    // Exit with failure when a member dropped out after being locked in
    if (!!group.ids && group.members.length < count) {
      return res.failure([503, 'GroupMemberExited']);
    }

    // Exit early when still waiting for group to fill
    if (group.members.length < count) {
      return res.success({});
    }

    // Make sure members list is locked in
    group.ids = group.ids || group.members.map(n => n.id);

    // Emit event that everyone has joined
    group.emitter.emit('joined', {ids: group.ids});

    // Exit early when this is a pair group
    if (count === minGroupCount) {
      return res.success({});
    }

    // Derive position in members list
    const {inbound, outbound} = partnersFromMembers({group, id: req.from});

    // Encode partners for wire
    const {records} = encodePartnersRecords({inbound, outbound});

    return res.success({records});
  });

  // Listen for and respond to connected confirmations
  service.request({type: serviceTypeConfirmConnected}, (req, res) => {
    if (!isArray(req.records)) {
      return res.failure([400, 'ExpectedArrayOfRecordsToConfirmConnection']);
    }

    const idRecord = findRecord(req.records, typeGroupId);

    if (!idRecord) {
      return res.failure([400, 'ExpectedGroupIdRecordToConfirmConnection']);
    }

    // Exit early when this request is for a different group
    if (idRecord.value !== id) {
      return;
    }

    // Group ids must be locked in before connections start
    if (!group.ids) {
      return res.failure([503, 'GroupMembersAreNotLockedInToStartConnects']);
    }

    // Cannot confirm connected when not part of the locked in group
    if (!group.ids.includes(req.from)) {
      return res.failure([403, 'MembershipNotPresentInLockedInMembers']);
    }

    // Emit event that someone is connecting
    if (!group.connected.find(n => n.id === req.from)) {
      group.emitter.emit('connecting', {id: req.from});
    }

    // Refresh the connected list, evicting remote members who stopped pinging
    group.connected = group.connected
      .filter(n => !n.last_connected || n.last_connected > staleDate())
      .filter(n => n.id !== req.from);

    // Add the group connection details to the group
    group.connected.push({id: req.from, last_connected: now()});

    const {records} = encodeConnectedRecords({count: group.connected.length});

    // Emit event that all members are connected
    if (group.connected.length === count) {
      group.emitter.emit('connected', {});
    }

    return res.success({records});
  });

  // Listen for and respond to pending open registrations
  service.request({type: serviceTypeRegisterPendingOpen}, (req, res) => {
    if (!isArray(req.records)) {
      return res.failure([400, 'ExpectedArrayOfRecordsToRegisterPendingOpen']);
    }

    const idRecord = findRecord(req.records, typeGroupId);

    if (!idRecord) {
      return res.failure([400, 'ExpectedGroupIdRecordToRegisterPendingOpen']);
    }

    // Exit early when this request is for a different group
    if (idRecord.value !== id) {
      return;
    }

    // Cannot register pending when not part of the locked in group
    if (!group.ids.includes(req.from)) {
      return res.failure([403, 'MembershipNotPresentInLockedInMembers']);
    }

    try {
      decodePendingProposal({records: req.records});
    } catch (err) {
      return res.failure([400, err.message]);
    }

    const proposal = decodePendingProposal({records: req.records});

    // Register the proposal
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
  service.request({type: serviceTypeRegisterSignedOpen}, (req, res) => {
    if (!isArray(req.records)) {
      return res.failure([400, 'ExpectedArrayOfRecordsToRegisterSignedOpen']);
    }

    const idRecord = findRecord(req.records, typeGroupId);

    if (!idRecord) {
      return res.failure([400, 'ExpectedGroupIdRecordToRegisterSignedOpen']);
    }

    // Exit early when this request is for a different group
    if (idRecord.value !== id) {
      return;
    }

    // Cannot register signatures when not part of the locked in group
    if (!group.ids.includes(req.from)) {
      return res.failure([403, 'MembershipNotPresentInLockedInMembers']);
    }

    try {
      decodeSignedFunding({records: req.records});
    } catch (err) {
      return res.failure([400, err.message]);
    }

    const signed = decodeSignedFunding({records: req.records});

    // Register the signed funding
    if (!group.signed.find(n => n.id === req.from)) {
      // Emit event to indicate member has submitted their signed open
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
    connected: () => group.connected.push({id: identity}),
    events: group.emitter,
    partners: id => !!group.ids ? partnersFromMembers({group, id}) : undefined,
    proposed: pending => group.proposed.push(pending),
    sign: signed => group.signed.push(signed),
    signed: () => group.signed,
    unsigned: () => group.unsigned,
  };
};
