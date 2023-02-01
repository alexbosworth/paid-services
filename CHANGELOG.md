# Versions

## Version 4.3.3

- `createGroupChannel`: Show members that are present

## Version 4.2.2

- `manageSwap`: Add support for P2TR output addresses

## Version 4.1.0

- `createGroupChannel`: Add `members` to restrict and order group membership

## Version 4.0.5

- `manageTrades`: Fix connection to seller failing

## Version 4.0.1

- `createGroupChannel`: Add method to coordinate a channel group
- `joinGroupChannel`: Add method to join a channel group

### Breaking Changes

- Node.js version 14 or higher is now required

## Version 3.21.0

- `manageSwap`: Add recovery for swap requests
- `manageSwap`: Add support for experimental Lightning Loop MuSig2 Taproot swap

## Version 3.20.3

- `manageGroupJoin`: Allow coordinating pair when funds are below the capacity

## Version 3.20.2

- `manageGroupJoin`: Allow opening a pair channel when funds are below capacity

## Version 3.20.1

- `manageTrades`: Fix seller connection when not peered

## Version 3.20.0

- `manageGroupJoin`: Add support for 2 person groups

## Version 3.19.2

- `manageSwap`: Add support for inbound peer constraint
- `manageSwap`: Add support for external sweep address

## Version 3.18.0

- `manageGroupJoin`: Add conflict tx for safe funded pending channel deletion

## Version 3.17.2

- `manageGroupJoin`: Add method to coordinate or join a channels group

## Version 3.16.3

- `manageSwap`: Add external funding, conf target setting, keysend pushes

## Version 3.15.4

- `manageSwap`: Add method to execute submarine swaps on testnet

## Version 3.14.5

- `manageTrades`: Fix connecting to sellers when not already connected

## Version 3.14.4

- `manageTrades`: Fix listing of trades that have fiat-pricing

## Version 3.14.1

- `manageTrades`: Add support for dynamic fiat-priced trades

## Version 3.13.2

- `acceptTrade`: Fix `logger` to be documented as an arg and optional

## Version 3.13.0

- `manageTrades`: Add support for experimental channel trades

## Version 3.12.2

- `serviceOpenTrade`: Fix regtest network support

## Version 3.12.1

- `balancedOpenRequest`: Add method to derive balanced open proposal details

## Version 3.11.4

- `changeChannelCapacity`: Add `nodes` to allow moving channel to another node

## Version 3.10.0

- `createAnchoredTrade`: Add method to create an anchored open trade
- `getAnchoredTrade`: Add method to get an anchored open trade

## Version 3.9.1

- `decodeTrade`: Add method to decode a trade-secret

## Version 3.8.0

- `encodeTrade`: Add method to encode a trade-secret
- `serviceAnchoredTrades`: Add method to serve open trade-secrets

## Version 3.7.0

- `changeChannelCapacity`: Add support for decreasing funds into a new channel

## Version 3.6.0

- `manageTrades`: Add support for persistent open trades
- `manageTrades`: Add expiration dates to open trades
- `manageTrades`: Support longer-lived open trade scenarios
- `manageTrades`: Show final encoded trade when requesting open trade
- `manageTrades`: Check for RPC signer support before trading

## Version 3.5.1

- `changeChannelCapacity`: Allow changing private/public status of channel

## Version 3.4.0

- `changeChannelCapacity`: Fix broken preservation of channel announce status
- `manageTrades`: Add support for open-ended trades

## Version 3.3.0

- `changeChannelCapacity`: Add method to change a channel's capacity

## Version 3.2.0

- `makePeerRequest`: Add method to make peer messaging requests
- `servicePeerRequests`: Add method to handle peer messaging requests

## Version 3.1.2

- `manageTrades`: Add method to create and interact with secret trades

## Version 3.0.0

- `servicePaidRequests`: Add service `invoice` request a payment request
- `servicePaidRequests`: Adjust `relay` service to execute retries on failure

### Breaking Changes

- `makeServiceRequest`: Change `paywall` to `invoice`

## Version 2.1.1

- Correct `relay` service summation of sending amount and fee

## Version 2.1.0

- Add service `connect` to allow requesting a peer connection

## Version 2.0.3

- `makeServiceRequest`: Switch back to regular payment call

## Version 2.0.1

- Add service `relay`

### Breaking Changes

- Add client data type to specify a payment request type field

## Version 1.1.0

- Add service: `activity`

## Version 1.0.0

- Add services: `schema`, `services`, `ping`, `profile`, `inbox`, `network`
