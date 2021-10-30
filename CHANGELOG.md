# Versions

## Version 3.1.1

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
