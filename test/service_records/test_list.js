const {deepStrictEqual, throws} = require('node:assert/strict');
const {test} = require('node:test');

const {hexAsList} = require('./../../service_records');
const {listAsHex} = require('./../../service_records');

// Many empty items, which are each only a length byte
const empties = Array(5000).fill(String());

// Encode a list and decode it again
const roundTrip = ({items}) => hexAsList(listAsHex({items}));

const tests = [
  {
    args: {encoded: '01aa02bbcc00'},
    description: 'Items are decoded one after another',
    expected: {items: ['aa', 'bbcc', '']},
    method: hexAsList,
  },
  {
    args: {encoded: ''},
    description: 'An empty list has no items',
    expected: {items: []},
    method: hexAsList,
  },
  {
    args: {encoded: 'fd0100' + '00'.repeat(256)},
    description: 'An item can have a length of more than one byte',
    expected: {items: ['00'.repeat(256)]},
    method: hexAsList,
  },
  {
    args: {items: ['aa', 'bbcc', '']},
    description: 'Items are encoded one after another',
    expected: {encoded: '01aa02bbcc00'},
    method: listAsHex,
  },
  {
    args: {items: empties},
    description: 'A list of many items is decoded to the same items',
    expected: {items: empties},
    method: roundTrip,
  },
  {
    args: {encoded: '02aa'},
    description: 'An item is as long as its length',
    error: 'ExpectedItemOfItsLengthInList',
    method: hexAsList,
  },
  {
    args: {encoded: '01aafd'},
    description: 'An item has a length that can be read',
    error: 'ExpectedItemLengthInList',
    method: hexAsList,
  },
  {
    args: {encoded: 'zz'},
    description: 'A list is hex',
    error: 'ExpectedHexToDecodeList',
    method: hexAsList,
  },
];

tests.forEach(({args, description, error, expected, method}) => {
  test(description, () => {
    if (!!error) {
      return throws(() => method(args), new Error(error), 'Got error');
    }

    deepStrictEqual(method(args), expected, 'Got expected result');
  });
});
