/** Map change requests to requests considering local channels

  {
    channels: [{
      capacity: <Channel Capacity Number>
      [cooperative_close_address]: <Cooperative Close Locked Address String>
      id: <Standard Format Channel Id String>
      partner_public_key: <Peer Public Key Hex String>
    }]
    requests: [{
      channel: <Standard Format Channel Id String>
      [decrease]: <Reduce Capacity Tokens Number>
      from: <From Node Public Key Id Hex String>
      id: <Change Request Id Hex String>
      [increase]: <Add Capacity Tokens Number>
    }]
  }

  @returns
  {
    requests: [{
      [address]: <Cooperative Close Address String>
      capacity: <Channel Capacity Tokens Number>
      channel: <Standard Format Channel Id String>
      [decrease]: <Reduce Capacity Tokens Number>
      from: <From Node Public Key Id Hex String>
      id: <Change Request Id Hex String>
      [increase]: <Add Capacity Tokens Number>
    }]
  }
*/
module.exports = ({channels, requests}) => {
  // Change requests can only come from channels with the messaging peer
  const capacityChangeRequests = requests.filter(request => {
    const channel = channels.find(chan => chan.id === request.channel);

    // Ignore requests from channels that aren't present
    if (!channel) {
      return false;
    }

    // The change request must come from the peer in the channel
    return channel.partner_public_key === request.from;
  });

  const existing = {};

  // Only consider one change request per channel
  const changeRequests = capacityChangeRequests
    .filter(({channel}) => {
      // Exit early when the channel already has a change request
      if (!!existing[channel]) {
        return false;
      }

      // Do not allow more requests for this channel
      existing[channel] = true;

      return true;
    })
    .map(request => {
      const channel = channels.find(chan => chan.id === request.channel);

      return {
        address: channel.cooperative_close_address,
        capacity: channel.capacity,
        channel: channel.id,
        decrease: request.decrease,
        from: channel.partner_public_key,
        id: request.id,
        increase: request.increase,
      };
    });

  return {requests: changeRequests};
};
