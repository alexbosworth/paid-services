# Lightning Network Paid Services

Paid service APIs that use KeySend as an interface.

## Default Services

### ping

This service delivers a pong message response

### schema

This service responds with metadata about a service

### services

This service delivers a list of available services

## Extended Services

Other services can be configured and enabled using their relevant environment variables.

### `inbox`

Deliver a short message via SMS or email.

To enable this service, configure the environment for sending messages:

```
# Use Postmark email for your inbox
PAID_SERVICES_INBOX_EMAIL_FROM="email to send from"
PAID_SERVICES_INBOX_EMAIL_TO="email to send to"
PAID_SERVICES_INBOX_POSTMARK_API_KEY="postmark API key"

# Use Twilio SMS for your inbox
PAID_SERVICES_INBOX_SMS_FROM_NUMBER="Number to send from"
PAID_SERVICES_INBOX_SMS_TO_NUMBER="Number to send to"
PAID_SERVICES_INBOX_TWILIO_ACCOUNT_SID="Twilio account id"
PAID_SERVICES_INBOX_TWILIO_AUTH_TOKEN="Twilio account id"

PAID_SERVICES_INBOX_PRICE="optional sats price to charge for inbox message"
```

### `network`

Reference other nodes that offer paid services:

```
PAID_SERVICES_NETWORK_NODES="comma separated node public keys"
```

### `profile`

Return a short profile description of your node.

To enable this service, set the profile of your node:

```
PAID_SERVICES_PROFILE_FOR_NODE="detail text about this node"
PAID_SERVICES_PROFILE_URLS="URL\nOTHER_URL" (separate multiple with newlines)
```
