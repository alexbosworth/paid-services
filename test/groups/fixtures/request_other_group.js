const makeGroup = require('./make_group');

// Change the last hex digit to guarantee a different group id
const differentId = id => id.slice(0, -1) + (id.endsWith('0') ? '1' : '0');

/** Request a different group before membership locks

  {
    type: <Peer Request Type Number String>
  }

  @returns
  <Decoded Peer Response Object Or Undefined>
*/
module.exports = args => {
  const group = makeGroup();
  const id = differentId(group.id);

  return group.request({id, type: args.type});
};
