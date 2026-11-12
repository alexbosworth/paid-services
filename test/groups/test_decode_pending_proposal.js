const {deepStrictEqual} = require('node:assert/strict');
const {test} = require('node:test');

const decodeProposal = require('./fixtures/decode_proposal');
const {encodePendingProposal} = require('./../../groups/messages');
const method = require('./../../groups/messages/decode_pending_proposal');
const utxos = require('./fixtures/proposal_utxos');

// Make a Taproot change script
const p2tr = byte => `5120${byte.repeat(32)}`;
// Make a SegWit funding script
const p2wsh = byte => `0020${byte.repeat(32)}`;
// Make a repeatable group id
const groupId = byte => byte.repeat(16);
// Omit the funding output record
const notFunding = record => record.type !== '3';
// Keep the other proposal records
const withoutFunding = n => ({records: n.records.filter(notFunding)});
const change = p2tr('11');
const funding = p2wsh('22');
const id = groupId('33');
const expected = {funding, utxos};

const tests = [
  {
    args: encodePendingProposal({funding, id, utxos}),
    description: 'A pending proposal without change round trips',
    expected: {...expected, change: undefined},
  },
  {
    args: encodePendingProposal({change, funding, id, utxos}),
    description: 'A pending proposal with change round trips',
    expected: {change, ...expected},
  },
  {
    args: withoutFunding(encodePendingProposal({funding, id, utxos})),
    description: 'A pending proposal still requires a funding output',
    expected: {error: 'ExpectedFundingOutputToDecodePendingProposal'},
  },
  {
    args: {records: [{type: '3', value: funding}]},
    description: 'A pending proposal still requires UTXO records',
    expected: {error: 'ExpectedUtxosRecordToDecodePendingProposal'},
  },
];

tests.forEach(({args, description, expected}) => {
  test(description, () => {
    deepStrictEqual(decodeProposal({method, proposal: args}), expected);
  });
});
